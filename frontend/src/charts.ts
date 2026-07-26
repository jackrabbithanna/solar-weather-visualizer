import {domain} from '../wailsjs/go/models';

type Metric = {
    key: keyof domain.TelemetryPoint;
    label: string;
    unit: string;
    color: string;
    zero?: boolean;
};

export type ChartEventMarker = {
    time: number;
    label: string;
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
    selectedEvent?: ChartEventMarker,
): void {
    if (!points.length) {
        container.innerHTML = '<div class="empty-chart">No telemetry loaded</div>';
        return;
    }
    const sampled = points.length > 700
        ? samplePoints(points, Math.ceil(points.length / 700))
        : points;
    container.innerHTML = metrics.map((metric) => chart(metric, sampled, cursor, selectedEvent)).join('');
}

function samplePoints(points: domain.TelemetryPoint[], step: number): domain.TelemetryPoint[] {
    const sampled = points.filter((_, index) => index % step === 0);
    const last = points[points.length - 1];
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
}

function chart(
    metric: Metric,
    points: domain.TelemetryPoint[],
    cursor: number,
    selectedEvent?: ChartEventMarker,
): string {
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
    const eventMarker = selectedEvent
        ? renderEventMarker(selectedEvent, first, last, x, padding.left, width - padding.right, padding.top, height - padding.bottom)
        : '';
    return `
      <article class="mini-chart">
        <header><span>${metric.label}</span><small>${format(maximum)} / ${format(minimum)} ${metric.unit}</small></header>
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="${metric.label} chart">
          ${zeroLine}
          ${segments.map((path) => `<path d="${path}" fill="none" stroke="${metric.color}" vector-effect="non-scaling-stroke"/>`).join('')}
          ${eventMarker}
          <line x1="${cursorX}" x2="${cursorX}" y1="${padding.top}" y2="${height - padding.bottom}" class="cursor-line"/>
        </svg>
      </article>`;
}

function renderEventMarker(
    marker: ChartEventMarker,
    first: number,
    last: number,
    x: (time: number) => number,
    left: number,
    right: number,
    top: number,
    bottom: number,
): string {
    const before = marker.time < first;
    const after = marker.time > last;
    const markerX = before ? left : after ? right : x(marker.time);
    const direction = before ? 'before' : after ? 'after' : 'inside';
    const indicator = before
        ? `<path d="M${left},${top + 4} L${left + 6},${top} L${left + 6},${top + 8} Z"/>`
        : after
            ? `<path d="M${right},${top + 4} L${right - 6},${top} L${right - 6},${top + 8} Z"/>`
            : '';
    const position = before ? 'before this chart' : after ? 'after this chart' : 'within this chart';
    return `
      <g class="selected-event-marker ${direction}">
        <title>Selected event: ${escapeXML(marker.label)} (${position})</title>
        <line x1="${markerX}" x2="${markerX}" y1="${top}" y2="${bottom}"/>
        ${indicator}
      </g>`;
}

function format(value: number): string {
    return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function escapeXML(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
