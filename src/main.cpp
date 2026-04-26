#include "aircraft.hpp"
#include "config.hpp"
#include "logger.hpp"
#include "visualizer.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

namespace {

// ---------------- Terminal handling ----------------
class TerminalRawMode {
public:
    TerminalRawMode() {
        tcgetattr(STDIN_FILENO, &oldTerm_);
        termios newTerm = oldTerm_;
        newTerm.c_lflag &= ~(ICANON | ECHO);
        tcsetattr(STDIN_FILENO, TCSANOW, &newTerm);

        oldFlags_ = fcntl(STDIN_FILENO, F_GETFL, 0);
        fcntl(STDIN_FILENO, F_SETFL, oldFlags_ | O_NONBLOCK);
    }

    ~TerminalRawMode() {
        tcsetattr(STDIN_FILENO, TCSANOW, &oldTerm_);
        fcntl(STDIN_FILENO, F_SETFL, oldFlags_);
    }

private:
    termios oldTerm_{};
    int oldFlags_{0};
};

double clampValue(double v, double lo, double hi) {
    return std::max(lo, std::min(v, hi));
}


struct NoFlyZone {
    std::string name;
    double cx;
    double cz;
    double radius;
};

// Fixed simulator coordinates.
// Make viewer JS use these same x/z values.
const std::vector<NoFlyZone> noFlyZones = {
    {"ZONE ALPHA",   1000.0,  3000.0,  680.0},
    {"ZONE BRAVO",  1000.0,  -6000.0,  820.0},
    {"ZONE CHARLIE",-1000.0, -1300.0,  600.0}
};

// ---------------- Keyboard ----------------
void readKeyboard(ControlInput& u, bool& running) {
    char c;
    while (read(STDIN_FILENO, &c, 1) > 0) {
        if (c == 'q' || c == 'Q') {
            running = false;
            return;
        }

        if (c == 'w' || c == 'W') {
            u.throttle_cmd = clampValue(u.throttle_cmd + 0.10, 0.0, 1.0);
        } else if (c == 's' || c == 'S') {
            u.throttle_cmd = clampValue(u.throttle_cmd - 0.10, 0.0, 1.0);
        } else if (c == 27) {
            char seq[2];
            if (read(STDIN_FILENO, &seq[0], 1) <= 0) continue;
            if (read(STDIN_FILENO, &seq[1], 1) <= 0) continue;

            if (seq[0] == '[') {
                if (seq[1] == 'A') {
                    u.pitch_cmd = clampValue(u.pitch_cmd + 0.20, cfg::maxPitchDown, cfg::maxPitchUp);
                } else if (seq[1] == 'B') {
                    u.pitch_cmd = clampValue(u.pitch_cmd - 0.20, cfg::maxPitchDown, cfg::maxPitchUp);
                } else if (seq[1] == 'C') {
                    u.roll_cmd = clampValue(u.roll_cmd + 0.18, -cfg::maxRoll, cfg::maxRoll);
                } else if (seq[1] == 'D') {
                    u.roll_cmd = clampValue(u.roll_cmd - 0.18, -cfg::maxRoll, cfg::maxRoll);
                }
            }
        }
    }
}

// ---------------- Altitude pitch HOCBF ----------------
double filterPitchCmdHOCBF(const AircraftState& s, const ControlInput& u) {
    const double y = s.y;
    const double p = s.pitch;
    const double v = s.v;

    const double targetSpeed = cfg::minSpeed + u.throttle_cmd * (cfg::maxSpeed - cfg::minSpeed);
    const double vdot = cfg::kThrottle * (targetSpeed - v);

    const double ydot = v * std::sin(p);

    const double a = vdot * std::sin(p) - v * std::cos(p) * cfg::kPitch * p;
    const double b = v * std::cos(p) * cfg::kPitch;

    double safeLower = cfg::maxPitchDown;
    double safeUpper = cfg::maxPitchUp;

    if (std::abs(b) > cfg::eps) {
        const double hFloor = y - cfg::yMin;
        const double lowerFromFloor =
            -(a + cfg::alpha1 * ydot + cfg::alpha0 * hFloor) / b;

        const double hCeil = cfg::yMax - y;
        const double upperFromCeiling =
            (-a - cfg::alpha1 * ydot + cfg::alpha0 * hCeil) / b;

        safeLower = std::max(safeLower, lowerFromFloor);
        safeUpper = std::min(safeUpper, upperFromCeiling);
    }

    if (safeLower > safeUpper) {
        const double mid = clampValue(0.5 * (safeLower + safeUpper), cfg::maxPitchDown, cfg::maxPitchUp);
        safeLower = safeUpper = mid;
    }

    const double raw = clampValue(u.pitch_cmd, cfg::maxPitchDown, cfg::maxPitchUp);
    return clampValue(raw, safeLower, safeUpper);
}

// ---------------- No-fly-zone roll CBF ----------------
double filterRollCmdNFZCBF(const AircraftState& s, const ControlInput& u) {
    double filtered = clampValue(u.roll_cmd, -cfg::maxRoll, cfg::maxRoll);

    for (const auto& zone : noFlyZones) {
        const double safeRadius = zone.radius + cfg::nfzBuffer;

        const double dx = s.x - zone.cx;
        const double dz = s.z - zone.cz;
        const double dist = std::sqrt(dx * dx + dz * dz);
        const double margin = dist - zone.radius;

        if (dist > safeRadius + cfg::nfzActivationDist) {
            continue;
        }

        // Current heading velocity
        const double vx = s.v * std::cos(s.yaw);
        const double vz = s.v * std::sin(s.yaw);

        // h = distance^2 - safeRadius^2
        const double h = dx * dx + dz * dz - safeRadius * safeRadius;

        // hdot using current velocity
        const double hdot_nom = 2.0 * (dx * vx + dz * vz);

        // If already moving away and not close, do not interfere
        if (hdot_nom + cfg::nfzAlpha * h >= 0.0 && margin > 300.0) {
            continue;
        }

        // Try roll candidates and choose closest safe roll command.
        double bestRoll = filtered;
        double bestCost = 1e18;
        bool found = false;

        constexpr int N = 121;
        constexpr double predictDt = 0.35;

        for (int i = 0; i < N; i++) {
            const double candidate =
                -cfg::maxRoll + (2.0 * cfg::maxRoll) * static_cast<double>(i) / static_cast<double>(N - 1);

            // Predict roll response ahead, not just one 20 ms frame
            double rollNext = s.roll + cfg::kRoll * (candidate - s.roll) * predictDt;
            rollNext = clampValue(rollNext, -cfg::maxRoll, cfg::maxRoll);

            const double yawRate =
                cfg::yawRateScale * (cfg::g * std::tan(rollNext) / std::max(s.v, cfg::minSpeed));

            const double yawNext = s.yaw + yawRate * predictDt;

            const double vxNext = s.v * std::cos(yawNext);
            const double vzNext = s.v * std::sin(yawNext);

            const double hdot = 2.0 * (dx * vxNext + dz * vzNext);
            const double cbfValue = hdot + cfg::nfzAlpha * h;

            if (cbfValue >= 0.0) {
                const double cost = std::abs(candidate - filtered);
                if (cost < bestCost) {
                    bestCost = cost;
                    bestRoll = candidate;
                    found = true;
                }
            }
        }

        if (found) {
            filtered = bestRoll;
        } else {
            const double bearingToZone = std::atan2(zone.cz - s.z, zone.cx - s.x);
            double err = bearingToZone - s.yaw;
            while (err > M_PI)  err -= 2.0 * M_PI;
            while (err < -M_PI) err += 2.0 * M_PI;
            filtered = (err > 0.0) ? -cfg::maxRoll : cfg::maxRoll;
        }
    }

    return clampValue(filtered, -cfg::maxRoll, cfg::maxRoll);
}

} // namespace

int main() {
    TerminalRawMode terminalMode;

    Aircraft aircraft;
    ControlInput u{0.0, 0.0, 0.5};

    Logger logger("flight_log.csv");
    VisualizerWriter visualizer("viewer");

    constexpr double dt = 0.01;
    constexpr double decay = 0.992;

    double simTime = 0.0;
    bool running = true;

    std::cout << "Controls:\n";
    std::cout << "  Up / Down    : pitch up / down\n";
    std::cout << "  Left / Right : roll left / right\n";
    std::cout << "  W / S        : throttle up / down\n";
    std::cout << "  Q            : quit\n\n";

    std::cout << "Altitude CBF:\n";
    std::cout << "  Floor   : 1000 m\n";
    std::cout << "  Ceiling : 3000 m\n\n";

    std::cout << "No-fly-zone roll CBF enabled:\n";
    for (const auto& z : noFlyZones) {
        std::cout << "  " << z.name
                  << " center=(" << z.cx << ", " << z.cz << ")"
                  << " radius=" << z.radius << " m\n";
    }
    std::cout << "\n";

    while (running) {
        readKeyboard(u, running);

        u.roll_cmd *= decay;
        u.pitch_cmd *= decay;

        if (std::abs(u.roll_cmd) < 0.001) u.roll_cmd = 0.0;
        if (std::abs(u.pitch_cmd) < 0.001) u.pitch_cmd = 0.0;

        u.pitch_cmd = filterPitchCmdHOCBF(aircraft.state, u);
        u.roll_cmd  = filterRollCmdNFZCBF(aircraft.state, u);

        aircraft.update(u, dt);
        visualizer.writeState(aircraft.state, u);
        logger.log(simTime, aircraft.state, u);

        simTime += dt;


        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }

    std::cout << "\nExited simulator.\n";
    return 0;
}