#include "aircraft.hpp"
#include "config.hpp"
#include <cmath>
#include <algorithm>

//initilizing aircraft start state
Aircraft::Aircraft() {
    state = {10000.0, 2000.0, 0.0, M_PI, 120.0, 0.0, 0.0};
}


void Aircraft::update(const ControlInput& u, double dt) {
    // commanded attitude / speed response
    state.roll += cfg::kRoll * (u.roll_cmd - state.roll) * dt;
    state.pitch += cfg::kPitch * (u.pitch_cmd - state.pitch) * dt;

    double targetSpeed = cfg::minSpeed + u.throttle_cmd * (cfg::maxSpeed - cfg::minSpeed);
    state.v += cfg::kThrottle * (targetSpeed - state.v) * dt;

    // clamp state
    state.roll = std::clamp(state.roll, -cfg::maxRoll, cfg::maxRoll);
    state.pitch = std::clamp(state.pitch, cfg::maxPitchDown, cfg::maxPitchUp);
    state.v = std::clamp(state.v, cfg::minSpeed, cfg::maxSpeed);

    // coordinated turn yaw model
    state.yaw += cfg::yawRateScale * (cfg::g * std::tan(state.roll) / state.v) * dt;

    state.x += state.v * std::cos(state.pitch) * std::cos(state.yaw) * dt;
    state.z += state.v * std::cos(state.pitch) * std::sin(state.yaw) * dt;
    state.y += state.v * std::sin(state.pitch) * dt;
}