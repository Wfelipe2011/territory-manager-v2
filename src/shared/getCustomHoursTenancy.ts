export function getCustomHoursTenancy(tenantId?: number) {
    if (tenantId === 6) {
        return 24 * 7; // 7 dias
    }
    if (tenantId === 1) {
        return 24 * 7; // 7 dias
    }
    return 5; // 5 horas
}