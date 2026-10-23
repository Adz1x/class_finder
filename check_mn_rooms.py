import json
f=open('uoft-empy-rooms/utm_metis_data.json')
data=json.load(f)
rooms=set()
for date, hrs in data.get('byDateAndHour',{}).items():
    for hr, rows in hrs.items():
        for r in rows:
            if r[3]=='Maanjiwe Nendamowinan':
                rooms.add(r[4])
rooms_list=sorted(rooms)
print('MN rooms count:', len(rooms_list))
print(rooms_list)
