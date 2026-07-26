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

export type TelemetryChartViewport = {
    start: number;
    end: number;
    cursor: number;
    gaps?: domain.DataGap[];
    dataset?: string;
    issueCount?: number;
    cached?: boolean;
    stale?: boolean;
    selectedEvent?: ChartEventMarker;
};

const metrics: Metric[] = [
    {key: 'speedKms', label: 'Speed', unit: 'km/s', color: '#5ce0d1'},
    {key: 'densityPerCm3', label: 'Density', unit: 'p/cm³', color: '#f5bc6a'},
    {key: 'bzGsmNt', label: 'Bz GSM', unit: 'nT', color: '#e87891', zero: true},
];

export function renderTelemetryCharts(
    container: HTMLElement,
    points: domain.TelemetryPoint[],
    viewport: TelemetryChartViewport,
): void {
    const start = Math.min(viewport.start, viewport.end);
    const end = Math.max(viewport.start + 1, viewport.end);
    const ranged = points
        .map((point) => ({point, time: Date.parse(point.time)}))
        .filter((item) =>
            Number.isFinite(item.time) && item.time >= start && item.time <= end)
        .sort((left, right) => left.time - right.time)
        .map((item) => item.point);
    const sampled = ranged.length > 700
        ? samplePoints(ranged, Math.ceil(ranged.length / 700))
        : ranged;
    const normalizedViewport = {...viewport, start, end};
    container.classList.toggle('without-coverage', !ranged.length);
    container.innerHTML = (ranged.length ? coverageSummary(ranged, normalizedViewport) : '') +
        metrics.map((metric) => chart(metric, sampled, normalizedViewport)).join('');
}

function coverageSummary(
    points: domain.TelemetryPoint[],
    viewport: TelemetryChartViewport,
): string {
    const first = Date.parse(points[0].time);
    const last = Date.parse(points[points.length - 1].time);
    const span = Math.max(1, viewport.end - viewport.start);
    const gapDuration = (viewport.gaps ?? []).reduce((total, gap) => {
        const start = Math.max(first, viewport.start, Date.parse(gap.start));
        const end = Math.min(last, viewport.end, Date.parse(gap.end));
        return Number.isFinite(start) && Number.isFinite(end) && end > start
            ? total + end - start
            : total;
    }, 0);
    const covered = Math.max(0, last - first - gapDuration);
    const coveragePercent = Math.max(0, Math.min(100, covered / span * 100));
    const gapCount = viewport.gaps?.length ?? 0;
    const partial = coveragePercent < 99 || gapCount > 0;
    const state = viewport.stale
        ? 'Stale cached telemetry'
        : partial ? 'Partial telemetry coverage' : 'Telemetry coverage complete';
    const details = [
        viewport.dataset,
        `${chartTime(first)} – ${chartTime(last)}`,
        `${coveragePercent.toFixed(coveragePercent < 10 ? 1 : 0)}% of Replay`,
        `${points.length.toLocaleString()} samples`,
        gapCount ? `${gapCount} ${gapCount === 1 ? 'gap' : 'gaps'}` : undefined,
        viewport.issueCount ? `${viewport.issueCount} provider ${viewport.issueCount === 1 ? 'warning' : 'warnings'}` : undefined,
        viewport.cached ? 'cached response' : undefined,
        'request complete',
    ].filter(Boolean).join(' · ');
    return `
      <div class="chart-coverage ${partial || viewport.stale ? 'partial' : 'complete'}" role="status">
        <i aria-hidden="true"></i>
        <span><strong>${escapeXML(state)}</strong><small>${escapeXML(details)}</small></span>
      </div>`;
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
    viewport: TelemetryChartViewport,
): string {
    const width = 500;
    const height = 86;
    const padding = {left: 42, right: 10, top: 10, bottom: 18};
    const values = points
        .map((point) => point[metric.key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const hasValues = values.length > 0;
    let minimum = hasValues ? Math.min(...values) : metric.zero ? -1 : 0;
    let maximum = hasValues ? Math.max(...values) : 1;
    if (metric.zero) {
        minimum = Math.min(minimum, 0);
        maximum = Math.max(maximum, 0);
    }
    if (minimum === maximum) {
        minimum -= 1;
        maximum += 1;
    }
    const middle = (minimum + maximum) / 2;
    const span = Math.max(1, viewport.end - viewport.start);
    const x = (time: number): number =>
        padding.left + (time - viewport.start) / span * (width - padding.left - padding.right);
    const y = (value: number): number => padding.top + (maximum - value) / (maximum - minimum) * (height - padding.top - padding.bottom);
    const segments: string[] = [];
    let current = '';
    let previousTime: number | undefined;
    for (const point of points) {
        const time = Date.parse(point.time);
        const value = point[metric.key];
        if (previousTime !== undefined && crossesGap(previousTime, time, viewport.gaps)) {
            if (current) segments.push(current);
            current = '';
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            current += `${current ? ' L' : 'M'}${x(time).toFixed(1)},${y(value).toFixed(1)}`;
        } else if (current) {
            segments.push(current);
            current = '';
        }
        previousTime = time;
    }
    if (current) segments.push(current);
    const zeroLine = hasValues && metric.zero && minimum < 0 && maximum > 0
        ? `<line x1="${padding.left}" x2="${width - padding.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"/>`
        : '';
    const cursorX = Math.max(padding.left, Math.min(width - padding.right, x(viewport.cursor)));
    const eventMarker = viewport.selectedEvent
        ? renderEventMarker(
            viewport.selectedEvent,
            viewport.start,
            viewport.end,
            x,
            padding.left,
            width - padding.right,
            padding.top,
            height - padding.bottom,
        )
        : '';
    const scaleLabels = hasValues
        ? [maximum, middle, minimum].map((value) => `<span>${format(value)}</span>`).join('')
        : '<span>—</span><span>—</span><span>—</span>';
    const scaleLines = [maximum, middle, minimum]
        .map((value) => `<line x1="${padding.left}" x2="${width - padding.right}"
            y1="${y(value)}" y2="${y(value)}"/>`)
        .join('');
    return `
      <article class="mini-chart ${hasValues ? '' : 'no-samples'}">
        <header><span>${metric.label}</span><small>${hasValues ? metric.unit : 'No samples'}</small></header>
        <div class="chart-plot">
          <div class="chart-y-scale" aria-hidden="true">${scaleLabels}</div>
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"
               aria-label="${metric.label} chart for ${chartTime(viewport.start)} through ${chartTime(viewport.end)};
                 scale ${format(minimum)} to ${format(maximum)} ${metric.unit}">
            <g class="scale-grid">${scaleLines}</g>
            ${hasValues ? '' : `<line x1="${padding.left}" x2="${width - padding.right}"
              y1="${y(middle)}" y2="${y(middle)}" class="empty-baseline"/>`}
            ${zeroLine}
            ${segments.map((path) => `<path d="${path}" fill="none" stroke="${metric.color}" vector-effect="non-scaling-stroke"/>`).join('')}
            ${eventMarker}
            <line x1="${cursorX}" x2="${cursorX}" y1="${padding.top}" y2="${height - padding.bottom}" class="cursor-line"/>
          </svg>
        </div>
        <footer class="chart-domain"><span>${chartTime(viewport.start)}</span><span>${chartTime(viewport.end)}</span></footer>
      </article>`;
}

function crossesGap(previous: number, current: number, gaps: domain.DataGap[] | undefined): boolean {
    return gaps?.some((gap) => {
        const gapStart = Date.parse(gap.start);
        const gapEnd = Date.parse(gap.end);
        return Number.isFinite(gapStart) && Number.isFinite(gapEnd) &&
            previous < gapEnd && current > gapStart;
    }) ?? false;
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

function chartTime(value: number): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(value);
}

function escapeXML(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
