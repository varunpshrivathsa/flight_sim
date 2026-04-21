#pragma once
#include "types.hpp"

class Aircraft {
public:
    State state;

    void update(double dt);
};