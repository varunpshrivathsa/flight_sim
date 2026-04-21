#pragma once
#include "types.hpp"

class StateMachine {
public:
    void update(State& state, double distance_to_goal);
};