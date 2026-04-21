#pragma once

enum class Mode {
    TAKEOFF,
    CLIMB,
    CRUISE,
    DESCENT,
    COMPLETE
};

struct State {
    double x, y, z;
    double speed;
    double heading;
    double vz;
    Mode mode;
};