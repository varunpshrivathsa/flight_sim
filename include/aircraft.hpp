#pragma once

//aircraft state
struct AircraftState {
    double x, y, z;
    double yaw;
    double v;
    double roll;
    double pitch;
};

//control input
struct ControlInput {
    double roll_cmd;
    double pitch_cmd;
    double throttle_cmd;
};

//declaring aircraft class with custom aircraft state and user input update fn in dt
class Aircraft {
public:
    AircraftState state;

    Aircraft();
    void update(const ControlInput& u, double dt);
};