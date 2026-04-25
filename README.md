# C-130 Flight Simulator with Control Barrier Functions

## Overview

This project implements a simplified 3D flight simulator inspired by a C-130-class aircraft, with a focus on **safety-critical control using Control Barrier Functions (CBFs)**.

The system allows manual control of the aircraft while automatically enforcing safety constraints through real-time control filtering.

---

## Dynamics Model

The aircraft state is defined as:

* Position: (x, y, z)
* Orientation: yaw, roll, pitch
* Speed: v

### Control Inputs

* `roll_cmd`
* `pitch_cmd`
* `throttle_cmd ∈ [0, 1]`

### State Evolution

Attitude and speed follow first-order dynamics:

* Roll:
  roll ← roll + kRoll (roll_cmd − roll) dt

* Pitch:
  pitch ← pitch + kPitch (pitch_cmd − pitch) dt

* Speed:
  v ← v + kThrottle (v_target − v) dt
  where
  v_target = v_min + throttle_cmd (v_max − v_min)

### Yaw (Coordinated Turn Model)

Yaw rate is governed by:

* yaw_dot = g * tan(roll) / v

This approximates coordinated turning behavior.

### Position Update

* x ← x + v cos(pitch) cos(yaw) dt
* z ← z + v cos(pitch) sin(yaw) dt
* y ← y + v sin(pitch) dt

---

## Safety via Control Barrier Functions

User inputs are filtered before being applied to the system.

### 1. Altitude Constraints (HOCBF)

* Floor: y ≥ 1000 m
* Ceiling: y ≤ 3000 m

A **Higher-Order Control Barrier Function (HOCBF)** is used to enforce:

h_floor = y − 1000 ≥ 0
h_ceiling = 3000 − y ≥ 0

Pitch commands are dynamically clamped to ensure:

ḧ + α₁ ḣ + α₀ h ≥ 0

This ensures smooth and anticipatory correction rather than abrupt clipping.

---

### 2. No-Fly Zone Avoidance (CBF)

Each no-fly zone is defined as:

* Center: (cx, cz)
* Radius: R

Barrier function:

h = (x − cx)² + (z − cz)² − (R + buffer)² ≥ 0

Behavior:

* When far → no intervention
* When approaching → roll commands are adjusted
* When critical → aggressive avoidance

Implementation:

* Predictive sampling of candidate roll inputs

* Choose closest safe roll satisfying:

  ḣ + α h ≥ 0

* Fallback: force turn away from zone center

---

## Controls

* Arrow keys:

  * Up / Down → Pitch
  * Left / Right → Roll
* W / S → Throttle
* Q → Quit

Commands decay over time to simulate pilot input relaxation.

---

## Simulation Details

* Time step: `dt = 0.01 s` (100 Hz)
* Real-time loop with sleep synchronization
* Continuous logging to `flight_log.csv`
* Live visualization via `state.json`

---

## Verification

The system can be validated by:

* Attempting descent below 1000 m → pitch is automatically corrected
* Attempting climb above 3000 m → pitch is limited
* Steering into restricted zones → roll is overridden
* Logs confirm constraint satisfaction over time

---

## Design Highlights

* Separation of simulation (C++) and visualization (Three.js)
* Real-time safety filtering at control-input level
* Predictive CBF-based avoidance (not reactive clipping)
* Modular architecture for extending dynamics or constraints

---

## Limitations

* Not a full 6DOF rigid-body model
* Simplified aerodynamic behavior
* CBF implemented via sampling instead of QP optimization
* No external disturbances (wind, turbulence)

---

## Future Improvements

* Full 6DOF aircraft dynamics
* Quadratic Programming (QP) based CBF solver
* Multi-agent collision avoidance
* Wind and turbulence modeling
* Trajectory replay and analysis tools


