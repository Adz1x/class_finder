import json
f=open('uoft-empy-rooms/utm_metis_data.json')
data=json.load(f)
found=False
for date, hrs in data.get('byDateAndHour',{}).items():
    for hr, rows in hrs.items():
        for r in rows:
            if len(r)>=5 and '3210' in r[4]:
                print('Found!', r)
                found=True
if not found:
    print('Not found in metis')
