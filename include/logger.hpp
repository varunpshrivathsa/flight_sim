#pragma once

#include "aircraft.hpp"
#include <fstream>
#include <string>

class Logger {
public:
    explicit Logger(const std::string& filename);
    ~Logger();

    void log(double time, const AircraftState& state, const ControlInput& input);

private:
    std::ofstream file_;
};