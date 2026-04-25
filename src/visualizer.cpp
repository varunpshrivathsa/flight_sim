#include "visualizer.hpp"

#include <fstream>
#include <iomanip>
#include <stdexcept>

VisualizerWriter::VisualizerWriter(const std::string& viewer_dir)
    : viewer_dir_(viewer_dir) {}

void VisualizerWriter::writeState(const AircraftState& state, const ControlInput& input) {
    std::ofstream file(viewer_dir_ + "/state.json");
    if (!file.is_open()) {
        throw std::runtime_error("Failed to open viewer/state.json");
    }

    file << std::fixed << std::setprecision(6);
    file << "{\n";
    file << "  \"aircraft\": {\n";
    file << "    \"x\": "     << state.x     << ",\n";
    file << "    \"y\": "     << state.y     << ",\n";
    file << "    \"z\": "     << state.z     << ",\n";
    file << "    \"yaw\": "   << state.yaw   << ",\n";
    file << "    \"roll\": "  << state.roll  << ",\n";
    file << "    \"pitch\": " << state.pitch << ",\n";
    file << "    \"speed\": " << state.v     << "\n";
    file << "  },\n";
    file << "  \"control\": {\n";
    file << "    \"roll_cmd\": "     << input.roll_cmd     << ",\n";
    file << "    \"pitch_cmd\": "    << input.pitch_cmd    << ",\n";
    file << "    \"throttle_cmd\": " << input.throttle_cmd << "\n";
    file << "  }\n";
    file << "}\n";
}
