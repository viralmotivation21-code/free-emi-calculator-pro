/* ─────────────────────────────────────────────────────────────
   EMI Sathi — real financial-calculation engine (client-side only).
   Reducing-balance EMI: EMI = P·r·(1+r)^n / ((1+r)^n − 1)
   All money is rounded to 2 decimals for display; the amortisation
   schedule self-corrects the final instalment so that:
     Σ principal ≈ P · Σ interest ≈ total interest · final balance = 0
   ───────────────────────────────────────────────────────────── */

export interface AmortRow {
  period: number; // 1-based month number
  year: number; // 1-based year number
  principalPaid: number;
  interestPaid: number;
  totalPayment: number;
  balance: number; // remaining balance AFTER this payment
}

export interface YearlyRow {
  year: number;
  months: number;
  principalPaid: number;
  interestPaid: number;
  totalPayment: number;
  endBalance: number;
}

export interface CalcResult {
  principal: number;
  annualRate: number;
  months: number;
  monthlyRate: number;
  emi: number; // rounded monthly instalment (last one may differ by paise)
  totalPayable: number;
  totalInterest: number;
  principalPct: number;
  interestPct: number;
  payoffDate: string;
}

export interface FieldErrors {
  principal?: string;
  rate?: string;
  tenure?: string;
}

export const LIMITS = {
  MIN_PRINCIPAL: 1000,
  MAX_PRINCIPAL: 1000000000, // ₹100 crore
  MAX_RATE: 60, // % p.a. — anything higher is almost certainly a typo
  MAX_MONTHS: 600, // 50 years
  MIN_MONTHS: 1,
} as const;

/** Round to 2 decimal places (paise). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Strip ₹, commas, spaces so "10,00,000" parses correctly. */
export function parseAmount(raw: string): number {
  if (typeof raw !== "string") return NaN;
  const cleaned = raw.replace(/[₹,\s]/g, "").trim();
  if (cleaned === "") return NaN;
  // allow digits with a single decimal point and an optional leading minus
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Validate raw input strings. Returns errors + parsed numbers. */
export function validateInputs(
  principalRaw: string,
  rateRaw: string,
  tenureRaw: string,
  tenureUnit: "years" | "months",
): { errors: FieldErrors; principal: number; annualRate: number; months: number } {
  const errors: FieldErrors = {};

  const principal = parseAmount(principalRaw);
  if (principalRaw.trim() === "" || Number.isNaN(principal)) {
    errors.principal = "Please enter a loan amount (e.g. 10,00,000).";
  } else if (principal <= 0) {
    errors.principal = "Loan amount must be greater than ₹0.";
  } else if (principal < LIMITS.MIN_PRINCIPAL) {
    errors.principal = `Loan amount must be at least ${formatINR0(LIMITS.MIN_PRINCIPAL)}.`;
  } else if (principal > LIMITS.MAX_PRINCIPAL) {
    errors.principal = `Loan amount looks too large (max ${formatINR0(LIMITS.MAX_PRINCIPAL)}).`;
  }

  const annualRate = parseAmount(rateRaw);
  if (rateRaw.trim() === "" || Number.isNaN(annualRate)) {
    errors.rate = "Please enter an interest rate (e.g. 8.5). 0 is allowed.";
  } else if (annualRate < 0) {
    errors.rate = "Interest rate cannot be negative.";
  } else if (annualRate > LIMITS.MAX_RATE) {
    errors.rate = `Interest rate looks too high (max ${LIMITS.MAX_RATE}% p.a.).`;
  }

  const tenureVal = parseAmount(tenureRaw);
  let months = 0;
  if (tenureRaw.trim() === "" || Number.isNaN(tenureVal)) {
    errors.tenure = `Please enter the loan tenure in ${tenureUnit}.`;
  } else if (tenureVal <= 0) {
    errors.tenure = "Tenure must be greater than 0.";
  } else {
    months = tenureUnit === "years" ? Math.round(tenureVal * 12) : Math.round(tenureVal);
    if (months < LIMITS.MIN_MONTHS) {
      errors.tenure = "Tenure must be at least 1 month.";
    } else if (months > LIMITS.MAX_MONTHS) {
      errors.tenure = `Tenure is too long (max ${LIMITS.MAX_MONTHS} months / 50 years).`;
    }
  }

  return { errors, principal, annualRate, months };
}

/**
 * Core EMI computation (no schedule). Handles the 0% special case
 * without ever dividing by zero.
 */
export function emiCore(
  principal: number,
  annualRate: number,
  months: number,
): { emi: number; totalPayable: number; totalInterest: number; monthlyRate: number } {
  if (!(principal > 0) || !(months >= 1)) {
    return { emi: 0, totalPayable: 0, totalInterest: 0, monthlyRate: 0 };
  }
  const monthlyRate = annualRate / 1200;
  if (monthlyRate === 0) {
    // Zero-interest special case — NEVER divide by the rate formula.
    // EMI = P / n, interest = 0, payable = principal exactly.
    const emi = round2(principal / months);
    return { emi, totalPayable: round2(principal), totalInterest: 0, monthlyRate: 0 };
  }
  const pow = Math.pow(1 + monthlyRate, months);
  const emi = round2((principal * monthlyRate * pow) / (pow - 1));
  const totalPayable = round2(emi * months);
  const totalInterest = round2(totalPayable - principal);
  return { emi, totalPayable, totalInterest, monthlyRate };
}

/**
 * Build the full month-by-month reducing-balance amortisation schedule.
 * Interest(m) = balance(m−1) × r · Principal(m) = EMI − Interest(m).
 * The final instalment is corrected for cumulative rounding so the
 * closing balance is exactly ₹0.
 */
export function buildSchedule(
  principal: number,
  annualRate: number,
  months: number,
): { rows: AmortRow[]; emi: number; totalPayable: number; totalInterest: number; monthlyRate: number } {
  const monthlyRate = annualRate / 1200;
  const rows: AmortRow[] = [];
  if (!(principal > 0) || !(months >= 1) || !Number.isFinite(monthlyRate) || monthlyRate < 0) {
    return { rows, emi: 0, totalPayable: 0, totalInterest: 0, monthlyRate: 0 };
  }

  const { emi } = emiCore(principal, annualRate, months);
  let balance = round2(principal);

  for (let m = 1; m <= months; m++) {
    const isLast = m === months;
    const interestPaid = monthlyRate === 0 ? 0 : round2(balance * monthlyRate);
    let principalPaid: number;
    let totalPayment: number;
    if (isLast) {
      principalPaid = round2(balance); // absorb any rounding residue
      totalPayment = round2(principalPaid + interestPaid);
      balance = 0;
    } else {
      principalPaid = round2(emi - interestPaid);
      // Safety: rounding must never overpay the balance early
      if (principalPaid > balance) principalPaid = round2(balance);
      if (principalPaid < 0) principalPaid = 0;
      totalPayment = round2(principalPaid + interestPaid);
      balance = round2(balance - principalPaid);
      if (balance < 0.005) balance = 0;
    }
    rows.push({
      period: m,
      year: Math.ceil(m / 12),
      principalPaid,
      interestPaid,
      totalPayment,
      balance,
    });
  }

  // Re-derive totals from the schedule itself so displayed sums always agree.
  let totalPayable = 0;
  let principalSum = 0;
  for (const r of rows) {
    totalPayable = round2(totalPayable + r.totalPayment);
    principalSum = round2(principalSum + r.principalPaid);
  }
  void principalSum;
  const totalInterest = round2(totalPayable - round2(principal));
  return { rows, emi, totalPayable, totalInterest, monthlyRate };
}

/** Aggregate monthly rows into yearly totals. */
export function aggregateYearly(rows: AmortRow[]): YearlyRow[] {
  const map = new Map<number, YearlyRow>();
  for (const r of rows) {
    const y = map.get(r.year) ?? {
      year: r.year,
      months: 0,
      principalPaid: 0,
      interestPaid: 0,
      totalPayment: 0,
      endBalance: r.balance,
    };
    y.months += 1;
    y.principalPaid = round2(y.principalPaid + r.principalPaid);
    y.interestPaid = round2(y.interestPaid + r.interestPaid);
    y.totalPayment = round2(y.totalPayment + r.totalPayment);
    y.endBalance = r.balance;
    map.set(r.year, y);
  }
  return [...map.values()].sort((a, b) => a.year - b.year);
}

/** Full calculation: validates nothing, just computes (callers validate first). */
export function calculateAll(
  principal: number,
  annualRate: number,
  months: number,
): { result: CalcResult; rows: AmortRow[]; yearly: YearlyRow[] } {
  const { rows, emi, totalPayable, totalInterest, monthlyRate } = buildSchedule(
    principal,
    annualRate,
    months,
  );
  const principalPct =
    totalPayable > 0 ? round2((round2(principal) / totalPayable) * 100) : 100;
  const interestPct = round2(100 - principalPct);
  const payoff = new Date();
  payoff.setMonth(payoff.getMonth() + months);
  const payoffDate = payoff.toLocaleString("en-IN", { month: "short", year: "numeric" });
  const result: CalcResult = {
    principal: round2(principal),
    annualRate,
    months,
    monthlyRate,
    emi,
    totalPayable,
    totalInterest,
    principalPct,
    interestPct,
    payoffDate,
  };
  return { result, rows, yearly: aggregateYearly(rows) };
}

/**
 * Prepayment simulation: pay `extra` over the EMI every month.
 * Returns the shortened schedule outcome.
 */
export function simulatePrepayment(
  principal: number,
  annualRate: number,
  months: number,
  extra: number,
): {
  monthsTaken: number;
  monthsSaved: number;
  totalInterest: number;
  interestSaved: number;
  totalPayable: number;
  payoffDate: string;
} {
  const base = buildSchedule(principal, annualRate, months);
  const r = annualRate / 1200;
  const safeExtra = extra > 0 && Number.isFinite(extra) ? round2(extra) : 0;
  if (safeExtra <= 0 || base.emi <= 0) {
    const payoff = new Date();
    payoff.setMonth(payoff.getMonth() + months);
    return {
      monthsTaken: months,
      monthsSaved: 0,
      totalInterest: base.totalInterest,
      interestSaved: 0,
      totalPayable: base.totalPayable,
      payoffDate: payoff.toLocaleString("en-IN", { month: "short", year: "numeric" }),
    };
  }
  let balance = round2(principal);
  let totalInterest = 0;
  let totalPayable = 0;
  let m = 0;
  const cap = months * 2 + 1200; // absolute guard against infinite loops
  while (balance > 0 && m < cap) {
    m += 1;
    const interest = r === 0 ? 0 : round2(balance * r);
    let payment = round2(base.emi + safeExtra);
    if (payment <= interest) payment = round2(interest + 1); // never negatively amortise
    let principalPaid = round2(payment - interest);
    if (principalPaid >= balance) {
      principalPaid = round2(balance);
      payment = round2(principalPaid + interest);
      balance = 0;
    } else {
      balance = round2(balance - principalPaid);
    }
    totalInterest = round2(totalInterest + interest);
    totalPayable = round2(totalPayable + payment);
  }
  const monthsSaved = Math.max(0, months - m);
  const payoff = new Date();
  payoff.setMonth(payoff.getMonth() + m);
  return {
    monthsTaken: m,
    monthsSaved,
    totalInterest,
    interestSaved: round2(base.totalInterest - totalInterest),
    totalPayable,
    payoffDate: payoff.toLocaleString("en-IN", { month: "short", year: "numeric" }),
  };
}

// ── Indian currency formatting ────────────────────────────────────

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const numIN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹10,00,000.00 style (2 decimals). Never returns NaN/Infinity text. */
export function formatINR(n: number): string {
  if (!Number.isFinite(n)) return "₹0.00";
  return inr2.format(round2(n));
}

/** ₹10,00,000 style (no decimals — for big totals & inputs). */
export function formatINR0(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  return inr0.format(Math.round(n));
}

/** Plain Indian-grouped number: 10,00,000 */
export function formatNumIN(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return numIN.format(n);
}

/** "10 Lakh", "2.5 Crore", "45 Thousand" — for the human-friendly hint. */
export function describeINR(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const trim = (v: number) =>
    Number.isInteger(v) ? v.toString() : v.toFixed(2).replace(/\.?0+$/, "");
  if (n >= 10000000) return `${trim(round2(n / 10000000))} Crore`;
  if (n >= 100000) return `${trim(round2(n / 100000))} Lakh`;
  if (n >= 1000) return `${trim(round2(n / 1000))} Thousand`;
  return trim(round2(n));
}

/** CSV export for the schedule (monthly or yearly view). */
export function scheduleToCSV(
  view: "monthly" | "yearly",
  rows: AmortRow[],
  yearly: YearlyRow[],
): string {
  if (view === "yearly") {
    const head = "Year,Months,Principal Paid (INR),Interest Paid (INR),Total Payment (INR),Year-End Balance (INR)";
    const lines = yearly.map((y) =>
      [y.year, y.months, y.principalPaid.toFixed(2), y.interestPaid.toFixed(2), y.totalPayment.toFixed(2), y.endBalance.toFixed(2)].join(","),
    );
    return [head, ...lines].join("\n");
  }
  const head = "Month,Year,Principal Paid (INR),Interest Paid (INR),Total Payment (INR),Remaining Balance (INR)";
  const lines = rows.map((r) =>
    [r.period, r.year, r.principalPaid.toFixed(2), r.interestPaid.toFixed(2), r.totalPayment.toFixed(2), r.balance.toFixed(2)].join(","),
  );
  return [head, ...lines].join("\n");
}
