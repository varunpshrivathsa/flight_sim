cmake_minimum_required(VERSION 3.10)
project(FlightSimulator)

set(CMAKE_CXX_STANDARD 17)

include_directories(include)

add_executable(sim
    src/main.cpp
    src/simulator.cpp
    src/aircraft.cpp
    src/state_machine.cpp
)