# Arka Energy — rooftop solar for Kerala homes

A single-page landing site told as one day in a Kerala tharavadu on the backwaters:
3:40 PM on the roof → golden hour savings → sunset on the veranda → a 9:52 PM power cut the house rides out on its battery → the monsoon → the next morning.

Everything is one self-contained `index.html`: a real-time Three.js world (house, backwater, palms, people, rain), live crops of the same house in the parts grid, and the UI around it.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. The page loads Three.js and fonts from public CDNs.

## Build

Sources live in `src/` and `assets/`. After editing, rebuild `index.html`:

```bash
python3 build.py
```

## Notes

- Testimonials, stats, prices, phone numbers and the app screens are placeholders — replace before launch.
- Figures and textures were generated for this project; icons are [Phosphor Icons](https://phosphoricons.com) (MIT).
- Useful URL flags: `?view=hero|energy|app|night|rain|dawn` renders a scene on its own; `?at=<section-id>` deep-links to a section.
