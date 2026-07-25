import {domain} from '../wailsjs/go/models';

type Metric = {
    key: keyof domain.TelemetryPoint;
    label: string;
    unit: string;
    color: string;
    zero?: boolean;
};

const metrics: Metric[] = [
    {key: 'speedKms', label: 'Speed', unit: 'km/s', color: '#5ce0d1'},
    {key: 'densityPerCm3', label: 'Density', unit: 'p/cm³', color: '#f5bc6a'},
    {key: 'bzGsmNt', label: 'Bz GSM', unit: 'nT', color: '#e87891', zero: true},
];

export function renderTelemetryCharts(
    container: HTMLElement,
    points: domain.TelemetryPoint[],
    cursor: number,
): void {
    if (!points.length) {
        container.innerHTML = '<div class="empty-chart">No telemetry loaded</div>';
        return;
    }
    const sampled = points.length > 700 ? points.filter((_, index) => index % Math.ceil(points.length / 700) === 0) : points;
    container.innerHTML = metrics.map((metric) => chart(metric, sampled, cursor)).join('');
}

function chart(metric: Metric, points: domain.TelemetryPoint[], cursor: number): string {
    const width = 500;
    const height = 86;
    const padding = {left: 42, right: 10, top: 10, bottom: 18};
    const values = points
        .map((point) => point[metric.key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!values.length) return '';
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (metric.zero) {
        minimum = Math.min(minimum, 0);
        maximum = Math.max(maximum, 0);
    }
    if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
    }
    const first = Date.parse(points[0].time);
    const last = Date.parse(points[points.length - 1].time);
    const span = Math.max(1, last - first);
    const x = (time: number): number => padding.left + (time - first) / span * (width - padding.left - padding.right);
    const y = (value: number): number => padding.top + (maximum - value) / (maximum - minimum) * (height - padding.top - padding.bottom);
    const segments: string[] = [];
    let current = '';
    for (const point of points) {
        const value = point[metric.key];
        if (typeof value !== 'number') {
            if (current) segments.push(current);
            current = '';
            continue;
        }
        current += `${current ? ' L' : 'M'}${x(Date.parse(point.time)).toFixed(1)},${y(value).toFixed(1)}`;
    }
    if (current) segments.push(current);
    const zeroLine = metric.zero && minimum < 0 && maximum > 0
        ? `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"/>`
        : '';
    const cursorX = Math.max(padding.left, Math.min(width - padding.right, x(cursor)));
    return `
      <article class="mini-chart">
        <header><span>${metric.label}</span><small>${format(maximum)} / ${format(minimum)} ${metric.unit}</small></header>
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${metric.label} chart">
          ${zeroLine}
          ${segments.map((path) => `<path d="${path}" fill="none" stroke="${metric.color}" vector-effect="non-scaling-stroke"/>`).join('')}
          <line x1="${cursorX}" x2="${cursorX}" y1="${padding.top}" y2="${height - padding.bottom}" class="cursor-line"/>
        </svg>
      </article>`;
}

function format(value: number): string {
    return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}
