export function utcInput(milliseconds: number): string {
    return new Date(milliseconds).toISOString().slice(0, 16);
}

export function utcInputDate(value: string): Date | undefined {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match) return undefined;
    const [, yearText, monthText, dayText, hourText, minuteText] = match;
    const expected = [
        Number(yearText),
        Number(monthText),
        Number(dayText),
        Number(hourText),
        Number(minuteText),
    ];
    const date = new Date(Date.UTC(
        expected[0],
        expected[1] - 1,
        expected[2],
        expected[3],
        expected[4],
    ));
    const actual = [
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
    ];
    return actual.every((part, index) => part === expected[index]) ? date : undefined;
}
