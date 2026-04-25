#pragma once

struct AircraftState {
    double x, y, z;
    double yaw;
    double v;
    double roll;
    double pitch;
};

struct ControlInput {
    double roll_cmd;
    double pitch_cmd;
    double throttle_cmd;
};

class Aircraft {
public:
    AircraftState state;

    Aircraft();
    void update(const ControlInput& u, double dt);
};