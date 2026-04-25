#pragma once

#include "aircraft.hpp"
#include <string>

class VisualizerWriter {
public:
    explicit VisualizerWriter(const std::string& viewer_dir);

    void writeState(const AircraftState& state, const ControlInput& input);

private:
    std::string viewer_dir_;
};
