// All the brochure figures live here. Edit a value, set `tbc: false` once it is
// checked against the real car, and the "to confirm" tag disappears.

export const specs = {
  overview: [
    { label: 'Body', value: '5-door hatchback', tbc: false },
    { label: 'Generation', value: 'K12', tbc: false },
    { label: 'Model code', value: 'DBA-AK12', tbc: false },
    { label: 'Built', value: '2007 · Japan', tbc: false },
    { label: 'First registered', value: '2011', tbc: false },
    { label: 'Seats', value: '5', tbc: false },
    { label: 'Steering', value: 'Right-hand drive', tbc: false },
  ],
  engine: [
    { label: 'Engine', value: 'CR12DE · 1.2 L inline-4, DOHC 16-valve', tbc: false },
    { label: 'Displacement', value: '1,240 cc', tbc: false },
    { label: 'Power', value: '90 PS', tbc: false },
    { label: 'Torque', value: '121 N·m', tbc: false },
    { label: 'Gearbox', value: '4-speed automatic', tbc: false },
    { label: 'Drive', value: 'Front-wheel drive', tbc: false },
    { label: 'Fuel', value: 'Petrol', tbc: false },
  ],
  dimensions: [
    // Length, width, height and weight are as printed on the registration certificate.
    { label: 'Length', value: '3,720 mm', tbc: false },
    { label: 'Width', value: '1,660 mm', tbc: false },
    { label: 'Height', value: '1,520 mm', tbc: false },
    { label: 'Wheelbase', value: '2,430 mm', tbc: false },
    { label: 'Unladen weight', value: '950 kg', tbc: false },
    { label: 'Fuel tank', value: '41 L', tbc: false },
  ],
  wheels: [
    { label: 'Tyre size', value: '165-section on 14-inch, front and rear', tbc: false },
    { label: 'Tyre profile', value: '165/70R14', tbc: false },
    { label: 'Wheels', value: '14-inch alloys', tbc: false },
    { label: 'Front brakes', value: 'Disc', tbc: false },
    { label: 'Rear brakes', value: 'Drum', tbc: false },
  ],
  colours: [
    { label: 'Exterior', value: 'Cream', note: 'Paint code E01', hex: '#EAE0C2', tbc: false },
    { label: 'Interior', value: 'Ivory', note: 'Woven seat centres', hex: '#DCD5BD', tbc: false },
    { label: 'Lower trim', value: 'Grey-beige', note: 'Console and armrests', hex: '#8A857A', tbc: false },
  ],
};

const tag = (item) => (item.tbc ? ' <span class="tbc">to confirm</span>' : '');

function render() {
  let anyTbc = false;
  for (const [key, items] of Object.entries(specs)) {
    const host = document.querySelector(`[data-specs="${key}"]`);
    if (!host) continue;
    anyTbc ||= items.some((i) => i.tbc);
    if (key === 'overview') {
      host.innerHTML = items
        .map((i) => `<div class="fact"><span>${i.label}</span><strong>${i.value}</strong>${tag(i)}</div>`)
        .join('');
    } else if (key === 'colours') {
      host.innerHTML = items
        .map(
          (i) => `<figure class="swatch"><i style="background:${i.hex}"></i>
            <figcaption><span>${i.label}</span><strong>${i.value}</strong><small>${i.note} · ${i.hex}</small></figcaption></figure>`
        )
        .join('');
    } else {
      host.innerHTML = items.map((i) => `<div><dt>${i.label}</dt><dd>${i.value}${tag(i)}</dd></div>`).join('');
    }
  }
  const notice = document.getElementById('placeholder-notice');
  if (notice) notice.hidden = !anyTbc;
}

render();
