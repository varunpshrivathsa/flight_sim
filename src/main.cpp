#include "aircraft.hpp"
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

// ---------------- Constants ----------------
constexpr double g = 9.81;

constexpr double kPitch = 14.0;
constexpr double kThrottle = 2.5;
constexpr double kRoll = 14.0;

constexpr double minSpeed = 90.0;
constexpr double maxSpeed = 380.0;

constexpr double maxRoll = 35.0 * M_PI / 180.0;
constexpr double maxPitchUp = 20.0 * M_PI / 180.0;
constexpr double maxPitchDown = -15.0 * M_PI / 180.0;

constexpr double yawRateScale = 3.5;

// altitude limits
constexpr double yMin = 1000.0;
constexpr double yMax = 3000.0;

// altitude HOCBF
constexpr double alpha0 = 0.8;
constexpr double alpha1 = 1.8;

// no-fly-zone CBF
constexpr double nfzAlpha = 3.5;
constexpr double nfzBuffer = 1500.0;
constexpr double nfzActivationDist = 6000.0;

constexpr double eps = 1e-6;

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
                    u.pitch_cmd = clampValue(u.pitch_cmd + 0.20, maxPitchDown, maxPitchUp);
                } else if (seq[1] == 'B') {
                    u.pitch_cmd = clampValue(u.pitch_cmd - 0.20, maxPitchDown, maxPitchUp);
                } else if (seq[1] == 'C') {
                    u.roll_cmd = clampValue(u.roll_cmd + 0.18, -maxRoll, maxRoll);
                } else if (seq[1] == 'D') {
                    u.roll_cmd = clampValue(u.roll_cmd - 0.18, -maxRoll, maxRoll);
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

    const double targetSpeed = minSpeed + u.throttle_cmd * (maxSpeed - minSpeed);
    const double vdot = kThrottle * (targetSpeed - v);

    const double ydot = v * std::sin(p);

    const double a = vdot * std::sin(p) - v * std::cos(p) * kPitch * p;
    const double b = v * std::cos(p) * kPitch;

    double safeLower = maxPitchDown;
    double safeUpper = maxPitchUp;

    if (std::abs(b) > eps) {
        const double hFloor = y - yMin;
        const double lowerFromFloor =
            -(a + alpha1 * ydot + alpha0 * hFloor) / b;

        const double hCeil = yMax - y;
        const double upperFromCeiling =
            (-a - alpha1 * ydot + alpha0 * hCeil) / b;

        safeLower = std::max(safeLower, lowerFromFloor);
        safeUpper = std::min(safeUpper, upperFromCeiling);
    }

    if (safeLower > safeUpper) {
        const double mid = clampValue(0.5 * (safeLower + safeUpper), maxPitchDown, maxPitchUp);
        safeLower = safeUpper = mid;
    }

    const double raw = clampValue(u.pitch_cmd, maxPitchDown, maxPitchUp);
    return clampValue(raw, safeLower, safeUpper);
}

// ---------------- No-fly-zone roll CBF ----------------
double filterRollCmdNFZCBF(const AircraftState& s, const ControlInput& u) {
    double filtered = clampValue(u.roll_cmd, -maxRoll, maxRoll);

    for (const auto& zone : noFlyZones) {
        const double safeRadius = zone.radius + nfzBuffer;

        const double dx = s.x - zone.cx;
        const double dz = s.z - zone.cz;
        const double dist = std::sqrt(dx * dx + dz * dz);
        const double margin = dist - zone.radius;

        if (dist > safeRadius + nfzActivationDist) {
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
        if (hdot_nom + nfzAlpha * h >= 0.0 && margin > 300.0) {
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
                -maxRoll + (2.0 * maxRoll) * static_cast<double>(i) / static_cast<double>(N - 1);

            // Predict roll response ahead, not just one 20 ms frame
            double rollNext = s.roll + kRoll * (candidate - s.roll) * predictDt;
            rollNext = clampValue(rollNext, -maxRoll, maxRoll);

            // Predict yaw response from coordinated turn model
            const double yawRate =
                yawRateScale * (g * std::tan(rollNext) / std::max(s.v, minSpeed));

            const double yawNext = s.yaw + yawRate * predictDt;

            const double vxNext = s.v * std::cos(yawNext);
            const double vzNext = s.v * std::sin(yawNext);

            const double hdot = 2.0 * (dx * vxNext + dz * vzNext);
            const double cbfValue = hdot + nfzAlpha * h;

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
            filtered = (err > 0.0) ? -maxRoll : maxRoll;
        }
    }

    return clampValue(filtered, -maxRoll, maxRoll);
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