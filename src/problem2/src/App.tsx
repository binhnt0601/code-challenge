import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Toaster, toast } from "sonner";
import {
  formatNumber,
  formatRate,
  formatTokenAmount,
  formatUsd,
  sanitizeNumericInput,
} from "./utils";

type PriceItem = {
  currency: string;
  price: number;
  date?: string;
};

type TokenOption = {
  currency: string;
  price: number;
  icon: string;
};

export const PRICE_URL = "https://interview.switcheo.com/prices.json";
export const MAX_INPUT_VALUE = 1_000_000_000_000;
export const MAX_DECIMALS = 6;
export const MAX_INPUT_LENGTH = 24;

const formSchema = z.object({
  amount: z
    .string()
    .min(1, "Please enter an amount")
    .refine((value) => !Number.isNaN(Number(value)), {
      message: "Amount must be a valid number",
    })
    .refine((value) => Number(value) > 0, {
      message: "Amount must be greater than 0",
    })
    .refine((value) => Number(value) <= MAX_INPUT_VALUE, {
      message: `Amount must be less than or equal to ${MAX_INPUT_VALUE.toLocaleString()}`,
    }),
});

type FormValues = z.infer<typeof formSchema>;

const buildTokenIconUrl = (currency: string) =>
  `https://raw.githubusercontent.com/Switcheo/token-icons/main/tokens/${currency}.svg`;

export default function App() {
  const [tokens, setTokens] = useState<TokenOption[]>([]);
  const [fromToken, setFromToken] = useState<string>("ETH");
  const [toToken, setToToken] = useState<string>("USDC");
  const [loading, setLoading] = useState<boolean>(true);
  const [amountInput, setAmountInput] = useState<string>("");
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [isCompletedModalOpen, setIsCompletedModalOpen] = useState(false);
  const [isProcessingSwap, setIsProcessingSwap] = useState(false);
  const warnedMaxRef = useRef(false);

  const {
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
    trigger,
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      amount: "",
    },
    mode: "onChange",
  });

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        setLoading(true);

        const response = await fetch(PRICE_URL);
        const data: PriceItem[] = await response.json();

        const latestByCurrency = new Map<string, PriceItem>();

        for (const item of data) {
          if (
            !item.currency ||
            typeof item.price !== "number" ||
            Number.isNaN(item.price) ||
            item.price <= 0
          ) {
            continue;
          }

          const existing = latestByCurrency.get(item.currency);

          if (!existing) {
            latestByCurrency.set(item.currency, item);
            continue;
          }

          const existingDate = existing.date
            ? new Date(existing.date).getTime()
            : 0;
          const currentDate = item.date ? new Date(item.date).getTime() : 0;

          if (currentDate >= existingDate) {
            latestByCurrency.set(item.currency, item);
          }
        }

        const normalizedTokens: TokenOption[] = Array.from(
          latestByCurrency.values()
        )
          .map((item) => ({
            currency: item.currency,
            price: item.price,
            icon: buildTokenIconUrl(item.currency),
          }))
          .sort((a, b) => a.currency.localeCompare(b.currency));

        setTokens(normalizedTokens);

        const defaultFrom =
          normalizedTokens.find((token) => token.currency === "ETH")
            ?.currency ??
          normalizedTokens[0]?.currency ??
          "";

        const defaultTo =
          normalizedTokens.find((token) => token.currency === "USDC")
            ?.currency ??
          normalizedTokens.find((token) => token.currency !== defaultFrom)
            ?.currency ??
          normalizedTokens[0]?.currency ??
          "";

        setFromToken(defaultFrom);
        setToToken(defaultTo);
      } catch {
        toast.error("Failed to load token prices");
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();
  }, []);

  const fromTokenData = useMemo(
    () => tokens.find((token) => token.currency === fromToken),
    [tokens, fromToken]
  );

  const toTokenData = useMemo(
    () => tokens.find((token) => token.currency === toToken),
    [tokens, toToken]
  );

  const numericAmount = useMemo(() => {
    const parsed = Number(amountInput);
    return Number.isNaN(parsed) ? 0 : parsed;
  }, [amountInput]);

  const rate = useMemo(() => {
    if (!fromTokenData || !toTokenData) return 0;
    return fromTokenData.price / toTokenData.price;
  }, [fromTokenData, toTokenData]);

  const outputAmount = useMemo(() => {
    if (!amountInput || numericAmount <= 0 || !rate) {
      return 0;
    }

    return numericAmount * rate;
  }, [amountInput, numericAmount, rate]);

  const handleAmountChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const rawValue = event.target.value;
    const sanitized = sanitizeNumericInput(rawValue);

    if (
      rawValue !== sanitized &&
      Number(sanitized) >= MAX_INPUT_VALUE &&
      !warnedMaxRef.current
    ) {
      toast.warning(`Maximum amount is ${formatNumber(MAX_INPUT_VALUE)}`);
      warnedMaxRef.current = true;
    }

    if (Number(sanitized) < MAX_INPUT_VALUE) {
      warnedMaxRef.current = false;
    }

    setAmountInput(sanitized);
    setValue("amount", sanitized, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
    await trigger("amount");
  };

  const handleAmountBlur = async () => {
    if (!amountInput) return;

    const normalized = sanitizeNumericInput(amountInput);
    setAmountInput(normalized);
    setValue("amount", normalized, {
      shouldValidate: true,
      shouldDirty: true,
      shouldTouch: true,
    });
    await trigger("amount");
  };

  const swapTokens = () => {
    if (fromToken === toToken) {
      toast.warning("Tokens are already the same");
      return;
    }

    setFromToken(toToken);
    setToToken(fromToken);
    toast.success("Swap direction updated");
  };

  const onSubmit = async () => {
    if (fromToken === toToken) {
      toast.error("From token and to token must be different");
      return;
    }

    if (!fromTokenData || !toTokenData) {
      toast.error("Please select valid tokens");
      return;
    }

    setIsConfirmModalOpen(true);
  };

  const handleConfirmSwap = async () => {
    setIsProcessingSwap(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      setIsConfirmModalOpen(false);
      setIsCompletedModalOpen(true);
      toast.success("Swap completed successfully");
    } catch {
      toast.error("Swap failed. Please try again.");
    } finally {
      setIsProcessingSwap(false);
    }
  };

  const handleCloseCompletedModal = () => {
    setAmountInput("");
    reset({
      amount: "",
    });
    warnedMaxRef.current = false;
    setIsCompletedModalOpen(false);
  };

  return (
    <>
      <Toaster richColors position="top-right" />
      <div className="page">
        <div className="swap-card">
          <div className="swap-header">
            <div>
              <p className="eyebrow">Fancy Form</p>
              <h1>Currency Swap</h1>
            </div>
            <div className="status-pill">
              {loading ? "Loading..." : "Live prices"}
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="swap-form">
            <div className="panel">
              <div className="panel-top">
                <span>Amount to send</span>
                {fromTokenData && (
                  <span className="usd-hint">
                    {amountInput
                      ? formatUsd(numericAmount * fromTokenData.price)
                      : "$0.00"}
                  </span>
                )}
              </div>

              <div className="panel-main">
                <div className="amount-input-wrap">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amountInput}
                    onChange={handleAmountChange}
                    onBlur={handleAmountBlur}
                    className={`amount-input ${
                      errors.amount ? "input-error" : ""
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>

                <TokenSelect
                  tokens={tokens.filter((token) => token.currency !== toToken)}
                  value={fromToken}
                  onChange={setFromToken}
                />
              </div>

              {errors.amount ? (
                <p className="error-text">{errors.amount.message}</p>
              ) : (
                <p className="helper-text">
                  Max {formatNumber(MAX_INPUT_VALUE)}.
                </p>
              )}
            </div>

            <div className="swap-action-row">
              <button
                type="button"
                className="swap-icon-button"
                onClick={swapTokens}
                aria-label="Swap token direction"
              >
                ⇅
              </button>
            </div>

            <div className="panel">
              <div className="panel-top">
                <span>Amount to receive</span>
                {toTokenData && (
                  <span className="usd-hint">
                    {outputAmount
                      ? formatUsd(outputAmount * toTokenData.price)
                      : "$0.00"}
                  </span>
                )}
              </div>

              <div className="panel-main">
                <input
                  type="text"
                  value={outputAmount ? formatTokenAmount(outputAmount) : ""}
                  readOnly
                  placeholder="0.00"
                  className="amount-input readonly"
                />

                <TokenSelect
                  tokens={tokens.filter(
                    (token) => token.currency !== fromToken
                  )}
                  value={toToken}
                  onChange={setToToken}
                />
              </div>

              <p className="helper-text">
                Estimated amount based on latest available prices
              </p>
            </div>

            <div className="summary">
              <div className="summary-row">
                <span>Rate</span>
                <span>
                  1 {fromToken} = {rate ? formatRate(rate) : "0"} {toToken}
                </span>
              </div>

              <div className="summary-row">
                <div className="link-row">
                  <a
                    href={PRICE_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="price-link"
                  >
                    Price Link
                  </a>
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="submit-button"
              disabled={
                loading ||
                isSubmitting ||
                !amountInput ||
                !!errors.amount ||
                fromToken === toToken
              }
            >
              {loading ? "Loading prices..." : "Confirm Swap"}
            </button>

            {fromToken === toToken && (
              <p className="error-text center">
                Please choose two different tokens
              </p>
            )}
          </form>
        </div>
      </div>

      {isConfirmModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <p className="modal-eyebrow">Review swap</p>
            <h2 className="modal-title">Confirm your swap</h2>

            <div className="modal-summary">
              <div className="modal-summary-row">
                <span>You pay</span>
                <strong>
                  {formatTokenAmount(Number(amountInput || 0))} {fromToken}
                </strong>
              </div>

              <div className="modal-summary-row">
                <span>You receive</span>
                <strong>
                  {formatTokenAmount(outputAmount)} {toToken}
                </strong>
              </div>

              <div className="modal-summary-row">
                <span>Rate</span>
                <strong>
                  1 {fromToken} = {rate ? formatRate(rate) : "0"} {toToken}
                </strong>
              </div>

              <div className="modal-summary-row">
                <span>Estimated value</span>
                <strong>
                  {fromTokenData
                    ? formatUsd(Number(amountInput || 0) * fromTokenData.price)
                    : "$0.00"}
                </strong>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary-button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isProcessingSwap}
              >
                Cancel
              </button>

              <button
                type="button"
                className="modal-primary-button"
                onClick={handleConfirmSwap}
                disabled={isProcessingSwap}
              >
                {isProcessingSwap ? "Processing..." : "Confirm Swap"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCompletedModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card completed">
            <div className="success-badge">✓</div>
            <p className="modal-eyebrow">Completed</p>
            <h2 className="modal-title">Swap completed</h2>
            <p className="modal-description">
              Your swap has been successfully simulated.
            </p>

            <div className="modal-summary">
              <div className="modal-summary-row">
                <span>Swapped</span>
                <strong>
                  {formatTokenAmount(Number(amountInput || 0))} {fromToken}
                </strong>
              </div>

              <div className="modal-summary-row">
                <span>Received</span>
                <strong>
                  {formatTokenAmount(outputAmount)} {toToken}
                </strong>
              </div>
            </div>

            <div className="modal-actions single">
              <button
                type="button"
                className="modal-primary-button"
                onClick={handleCloseCompletedModal}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type TokenSelectProps = {
  tokens: TokenOption[];
  value: string;
  onChange: (value: string) => void;
};

function TokenSelect({ tokens, value, onChange }: TokenSelectProps) {
  const [iconErrorMap, setIconErrorMap] = useState<Record<string, boolean>>({});

  const selectedToken = tokens.find((token) => token.currency === value);
  const hasIconError = selectedToken
    ? iconErrorMap[selectedToken.currency]
    : false;

  return (
    <div className="token-select-wrapper">
      <div className="token-preview">
        {selectedToken ? (
          <>
            {!hasIconError ? (
              <img
                key={selectedToken.currency}
                src={selectedToken.icon}
                alt={selectedToken.currency}
                className="token-icon"
                onError={() => {
                  setIconErrorMap((prev) => ({
                    ...prev,
                    [selectedToken.currency]: true,
                  }));
                }}
              />
            ) : (
              <div className="token-icon-fallback">
                {selectedToken.currency.slice(0, 1)}
              </div>
            )}
            <span>{selectedToken.currency}</span>
          </>
        ) : (
          <span>Select</span>
        )}
      </div>

      <select
        className="token-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {tokens.map((token) => (
          <option key={token.currency} value={token.currency}>
            {token.currency}
          </option>
        ))}
      </select>
    </div>
  );
}
