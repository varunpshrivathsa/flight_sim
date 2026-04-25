#include "logger.hpp"

#include <iomanip>
#include <stdexcept>

Logger::Logger(const std::string& filename) : file_(filename) {
    if (!file_.is_open()) {
        throw std::runtime_error("Failed to open log file: " + filename);
    }

    file_ << "time,"
          << "x,y,z,"
          << "yaw,v,roll,pitch,"
          << "roll_cmd,pitch_cmd,throttle_cmd\n";
}

Logger::~Logger() {
    if (file_.is_open()) {
        file_.close();
    }
}

void Logger::log(double time, const AircraftState& state, const ControlInput& input) {
    file_ << std::fixed << std::setprecision(6)
          << time << ","
          << state.x << ","
          << state.y << ","
          << state.z << ","
          << state.yaw << ","
          << state.v << ","
          << state.roll << ","
          << state.pitch << ","
          << input.roll_cmd << ","
          << input.pitch_cmd << ","
          << input.throttle_cmd << "\n";
}