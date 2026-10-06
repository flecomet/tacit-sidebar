/** Token counts and cost, whatever shape the provider's usage object has. */

export const normalizeUsage = (usage = {}) => {
    const u = usage || {};
    const input = u.prompt_tokens ?? u.input_tokens ?? 0;
    const output = u.completion_tokens ?? u.output_tokens ?? 0;
    return { input, output, total: u.total_tokens || input + output };
};

/** Billed cost when the provider reports it (OpenRouter), else an estimate from per-token prices; null when unknown. */
export const computeCost = (usage, pricing) => {
    const reported = Number(usage?.cost);
    if (usage?.cost != null && Number.isFinite(reported) && reported >= 0) return reported;
    const p = Number(pricing?.prompt);
    const c = Number(pricing?.completion);
    if (!(p >= 0 && c >= 0)) return null; // missing, or a router's "-1" placeholder
    const { input, output } = normalizeUsage(usage);
    return p * input + c * output;
};

export const sessionCost = (messages = []) => (messages || []).reduce((sum, m) => {
    const cost = m?.metadata?.cost;
    return Number.isFinite(cost) && cost > 0 ? sum + cost : sum;
}, 0);

export const formatCost = (n) => {
    if (n < 0.0001) return '<$0.0001';
    return n < 1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
};
