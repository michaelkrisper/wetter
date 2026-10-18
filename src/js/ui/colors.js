// Temperature colour scale shared by the chart and the daily range bars.
const STOPS = [
  [-15, [196, 181, 253]],
  [-5, [129, 140, 248]],
  [3, [56, 189, 248]],
  [12, [52, 211, 153]],
  [20, [251, 191, 36]],
  [27, [249, 115, 22]],
  [34, [239, 68, 68]],
];

export function tempColor(t) {
  if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f))})`;
    }
  }
  return `rgb(${STOPS.at(-1)[1]})`;
}

// Precipitation intensity (mm/h) to 0..1 on a log scale: 0.1 is barely
// visible, 1 is about half, 10 and more is full height.
export function rainScale(rate) {
  if (!(rate > 0)) return 0;
  return Math.min(1, 0.12 + (0.88 * Math.log1p(rate)) / Math.log1p(10));
}
