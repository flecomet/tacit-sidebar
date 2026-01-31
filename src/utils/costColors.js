/**
 * Returns the Tailwind CSS class for cost-based coloring.
 * 
 * Thresholds:
 * - null/undefined/0/NaN/negative: gray (unknown/unavailable)
 * - < $0.01: green (cheap)
 * - $0.01 - $0.04: blue (moderate)
 * - $0.04 - $0.10: yellow (elevated)
 * - $0.10 - $1.00: orange (expensive)
 * - >= $1.00: red (extreme)
 * 
 * @param {number|null|undefined} cost - The cost in dollars
 * @returns {string} Tailwind CSS class for the color
 */
export function getCostColorClass(cost) {
    // Handle missing, invalid, or zero cost
    if (cost === null || cost === undefined || isNaN(cost) || cost <= 0) {
        return 'text-gray-500';
    }

    if (cost < 0.01) {
        return 'text-cost-cheap';
    }
    if (cost < 0.04) {
        return 'text-cost-moderate';
    }
    if (cost < 0.10) {
        return 'text-cost-elevated';
    }
    if (cost < 1.00) {
        return 'text-cost-expensive';
    }
    return 'text-cost-extreme';
}
