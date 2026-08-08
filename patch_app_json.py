import json

with open('artifacts/mobile/app.json', 'r') as f:
    data = json.load(f)

plugins = data['expo']['plugins']
plugins.append([
    "expo-camera",
    {
        "cameraPermission": "Scan repair job QR codes."
    }
])

with open('artifacts/mobile/app.json', 'w') as f:
    json.dump(data, f, indent=2)
