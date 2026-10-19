"""Scraper for the UofT Timetable Builder (TTB) public API.

Produces a dataset of class meetings and classroom availability used by the
Next.js app in this repository.
"""

from .models import ClassMeeting, Room, Snapshot

__all__ = ["ClassMeeting", "Room", "Snapshot"]
__version__ = "0.2.0"
