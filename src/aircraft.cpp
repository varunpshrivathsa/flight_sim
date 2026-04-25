#include "aircraft.hpp"
#include <cmath>
#include <algorithm>

namespace {
constexpr double g = 9.81;

constexpr double kRoll = 14.0;
constexpr double kPitch = 14.0;
constexpr double kThrottle = 2.5;

constexpr double maxRoll = 35.0 * M_PI / 180.0;
constexpr double yawRateScale = 3.5;
constexpr double maxPitchUp = 20.0 * M_PI / 180.0;
constexpr double maxPitchDown = -15.0 * M_PI / 180.0;

constexpr double minSpeed = 90.0;
constexpr double maxSpeed = 380.0;
}

Aircraft::Aircraft() {
    state = {10000.0, 2000.0, 0.0, M_PI, 120.0, 0.0, 0.0};
}

void Aircraft::update(const ControlInput& u, double dt) {
    // commanded attitude / speed response
    state.roll += kRoll * (u.roll_cmd - state.roll) * dt;
    state.pitch += kPitch * (u.pitch_cmd - state.pitch) * dt;

    double targetSpeed = minSpeed + u.throttle_cmd * (maxSpeed - minSpeed);
    state.v += kThrottle * (targetSpeed - state.v) * dt;

    // clamp state
    state.roll = std::clamp(state.roll, -maxRoll, maxRoll);
    state.pitch = std::clamp(state.pitch, maxPitchDown, maxPitchUp);
    state.v = std::clamp(state.v, minSpeed, maxSpeed);

    // coordinated turn yaw model
    state.yaw += yawRateScale * (g * std::tan(state.roll) / state.v) * dt;

    // position update
    state.x += state.v * std::cos(state.pitch) * std::cos(state.yaw) * dt;
    state.z += state.v * std::cos(state.pitch) * std::sin(state.yaw) * dt;
    state.y += state.v * std::sin(state.pitch) * dt;
}