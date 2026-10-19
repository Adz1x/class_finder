import json

# Load metis data and extract all MN rooms
with open('uoft-empy-rooms/utm_metis_data.json') as f:
    d = json.load(f)

mn_rooms = set()
for date, hours in d.get('byDateAndHour', {}).items():
    for hr, rows in hours.items():
        for r in rows:
            if len(r) >= 6 and ' ' in r[4]:
                room_name = r[4].strip().upper()
                if room_name.startswith('MN '):
                    mn_rooms.add(room_name)

print('All MN rooms from metis:', sorted(mn_rooms))

# Check what's missing compared to REAL_BUILDING_ROOMS
real = {
    "MN": ["1170","1210","2100","2110","2130","2150","2190","2210","2260","2262","2264","2266","3100","3120","3140","3150","3160","3170","3180","3190","3220","3295"]
}
real_set = set()
for b, rooms in real.items():
    for r in rooms:
        real_set.add(f"{b} {r}")

missing = mn_rooms - real_set
print('MN rooms in metis but NOT in REAL_BUILDING_ROOMS:')
for r in sorted(missing):
    print(f'  {r}')

# Also check which are in real but not in metis
extra = real_set - mn_rooms
print('Rooms in REAL_BUILDING_ROOMS but NOT in metis:')
for r in sorted(extra):
    print(f'  {r}')