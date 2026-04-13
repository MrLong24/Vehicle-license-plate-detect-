import os
import sys
import time

# Ensure backend/ and processor.py are importable when running tests from repository root
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import backend
import processor


def setup_function():
    backend.plate_buffer.clear()
    backend.last_confirmed_plate = None
    backend.last_confirmed_time = 0


def test_confirm_plate_threshold_boundary():
    backend.plate_buffer.clear()
    backend.last_confirmed_plate = None
    backend.last_confirmed_time = 0

    assert backend.confirm_plate('30A1234') is None
    assert backend.confirm_plate('30A1234') is None
    assert backend.confirm_plate('30A1234') == '30A1234'


def test_confirm_plate_immediate_same_plate_within_cooldown():
    backend.plate_buffer.clear()
    backend.last_confirmed_plate = None
    backend.last_confirmed_time = 0

    backend.confirm_plate('30A1234')
    backend.confirm_plate('30A1234')
    confirmed = backend.confirm_plate('30A1234')
    assert confirmed == '30A1234'

    # Same plate again immediately should return None because of cooldown
    assert backend.confirm_plate('30A1234') is None


def test_confirm_plate_restart_after_cooldown():
    backend.plate_buffer.clear()
    backend.last_confirmed_plate = '30A1234'
    backend.last_confirmed_time = time.time() - backend.PLATE_COOLDOWN - 0.5
    backend.plate_buffer.clear()

    assert backend.confirm_plate('30A1234') is None
    assert backend.confirm_plate('30A1234') is None
    assert backend.confirm_plate('30A1234') == '30A1234'


def test_final_correction_boundary_length():
    # Length below 5 should return cleaned uppercase text unchanged beyond cleaning
    assert processor.final_correction('i0o1') == 'I0O1'

    # Length exactly 5 should apply correction rules
    assert processor.final_correction('i0o1b') == '10O18'


def test_final_correction_character_mapping():
    assert processor.final_correction('I01A234') == '10IA234'
