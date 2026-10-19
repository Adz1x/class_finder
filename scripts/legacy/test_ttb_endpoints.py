import urllib.request, json

endpoints = [
    "https://api.easi.utoronto.ca/ttb/getCourse/69d94299830c3634bbb68fb5",
    "https://api.easi.utoronto.ca/ttb/getCourse?courseId=69d94299830c3634bbb68fb5",
    "https://api.easi.utoronto.ca/ttb/getCourse?id=69d94299830c3634bbb68fb5"
]

for url in endpoints:
    print(f"Testing {url} ...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            print("  SUCCESS:", resp.status)
            data = json.loads(resp.read().decode('utf-8'))
            print("  Keys:", list(data.keys()))
    except Exception as e:
        print("  FAILED:", e)
