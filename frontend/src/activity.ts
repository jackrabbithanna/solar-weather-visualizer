export type ActivitySeverity = 'info' | 'warning' | 'error';

export interface ActivityEntry {
    id: number;
    timestamp: number;
    severity: ActivitySeverity;
    source: string;
    message: string;
    repeatCount: number;
}

export interface ActivityMessage {
    severity?: ActivitySeverity;
    source: string;
    message: string;
}

const severityRank: Record<ActivitySeverity, number> = {
    info: 0,
    warning: 1,
    error: 2,
};

export class ActivityLog extends EventTarget {
    readonly entries: ActivityEntry[] = [];
    unreadCount = 0;
    unreadSeverity: ActivitySeverity = 'info';
    private nextID = 1;
    private open = false;

    constructor(private readonly limit = 500) {
        super();
    }

    publish(message: ActivityMessage): void {
        const severity = message.severity ?? 'info';
        const previous = this.entries[this.entries.length - 1];
        if (previous &&
            previous.severity === severity &&
            previous.source === message.source &&
            previous.message === message.message) {
            previous.timestamp = Date.now();
            previous.repeatCount++;
        } else {
            this.entries.push({
                id: this.nextID++,
                timestamp: Date.now(),
                severity,
                source: message.source,
                message: message.message,
                repeatCount: 1,
            });
            if (this.entries.length > this.limit) {
                this.entries.splice(0, this.entries.length - this.limit);
            }
        }
        if (!this.open) {
            this.unreadCount++;
            if (severityRank[severity] > severityRank[this.unreadSeverity]) {
                this.unreadSeverity = severity;
            }
        }
        this.emit();
    }

    setOpen(open: boolean): void {
        this.open = open;
        if (open && this.unreadCount) {
            this.unreadCount = 0;
            this.unreadSeverity = 'info';
            this.emit();
        }
    }

    clear(): void {
        if (!this.entries.length && !this.unreadCount) return;
        this.entries.splice(0);
        this.unreadCount = 0;
        this.unreadSeverity = 'info';
        this.emit();
    }

    private emit(): void {
        this.dispatchEvent(new Event('change'));
    }
}

export class ActivityLogView {
    constructor(
        private readonly log: ActivityLog,
        private readonly list: HTMLElement,
        private readonly badge: HTMLElement,
        clearButton: HTMLButtonElement,
    ) {
        clearButton.onclick = () => log.clear();
        log.addEventListener('change', () => this.render());
        this.render();
    }

    render(): void {
        const wasAtBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 24;
        this.list.replaceChildren();
        if (!this.log.entries.length) {
            const empty = document.createElement('li');
            empty.className = 'activity-empty';
            empty.textContent = 'No application messages yet.';
            this.list.append(empty);
        } else {
            for (const entry of this.log.entries) {
                this.list.append(this.renderEntry(entry));
            }
        }
        this.renderBadge();
        if (wasAtBottom) this.list.scrollTop = this.list.scrollHeight;
    }

    private renderEntry(entry: ActivityEntry): HTMLLIElement {
        const item = document.createElement('li');
        item.className = `activity-entry ${entry.severity}`;

        const time = document.createElement('time');
        time.dateTime = new Date(entry.timestamp).toISOString();
        time.textContent = activityTime(entry.timestamp);

        const source = document.createElement('strong');
        source.textContent = entry.source;

        const message = document.createElement('span');
        message.textContent = entry.message;

        item.append(time, source, message);
        if (entry.repeatCount > 1) {
            const repeats = document.createElement('em');
            repeats.textContent = `×${entry.repeatCount}`;
            repeats.title = `Repeated ${entry.repeatCount} times`;
            item.append(repeats);
        }
        return item;
    }

    private renderBadge(): void {
        const count = this.log.unreadCount;
        this.badge.hidden = count === 0;
        this.badge.className = `activity-badge ${this.log.unreadSeverity}`;
        this.badge.textContent = count > 99 ? '99+' : String(count);
        this.badge.setAttribute(
            'aria-label',
            count
                ? `${count} unread application ${count === 1 ? 'message' : 'messages'}; highest severity ${this.log.unreadSeverity}`
                : 'No unread application messages',
        );
    }
}

function activityTime(milliseconds: number): string {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(milliseconds);
}
