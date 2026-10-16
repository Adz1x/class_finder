import json
f=open('uoft-empy-rooms/utm_metis_data.json')
data=json.load(f)
rooms=set()
count=0
for date, hrs in data.get('byDateAndHour',{}).items():
    for hr, rows in hrs.items():
        for r in rows:
            count+=1
            if len(r)>=5 and r[3]=='Maanjiwe Nendamowinan':
                rooms.add(r[4])
rooms_list=sorted(rooms)
print('Rows checked:', count)
print('MN rooms count:', len(rooms_list))
print(rooms_list)
