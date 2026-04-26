#pragma once

#include <cmath>

namespace cfg {

// ---- Physics ----
constexpr double g            = 9.81;

// ---- Response gains ----
constexpr double kRoll        = 14.0;
constexpr double kPitch       = 14.0;
constexpr double kThrottle    = 2.5;

// ---- Flight envelope ----
constexpr double minSpeed     = 90.0;
constexpr double maxSpeed     = 380.0;
constexpr double maxRoll      = 35.0 * M_PI / 180.0;
constexpr double maxPitchUp   = 20.0 * M_PI / 180.0;
constexpr double maxPitchDown = -15.0 * M_PI / 180.0;
constexpr double yawRateScale = 3.5;

// ---- Altitude limits ----
constexpr double yMin         = 1000.0;
constexpr double yMax         = 3000.0;

// ---- Altitude HOCBF gains ----
constexpr double alpha0       = 0.8;
constexpr double alpha1       = 1.8;

// ---- No-fly-zone CBF ----
constexpr double nfzAlpha          = 3.5;
constexpr double nfzBuffer         = 1500.0;
constexpr double nfzActivationDist = 6000.0;

// ---- Numerics ----
constexpr double eps          = 1e-6;

} // namespace cfg
