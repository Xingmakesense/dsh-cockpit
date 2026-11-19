        // -------------------------------------------------------------------
        // Styles (inline; the harness theme tokens are used when present).
        //
        // Only tokens that DSH actually defines may be referenced: an unknown
        // `var(--dsw-alias-…)` silently falls back, and a dark fallback on a
        // light page turns into dark-on-dark text. `--dsw-alias-bg-elevated`
        // and `--dsw-alias-bg-sunken` were exactly that trap. Fallbacks now use
        // system colours or translucent neutrals, which follow both themes.
        // -------------------------------------------------------------------
        const token = (name, fallback) => `var(${name}, ${fallback})`;
        const THEME = {
            surface: token("--dsw-alias-bg-module-platform", "rgba(127, 127, 127, 0.12)"),
            sunken: token("--dsw-alias-interactive-bg-hover", "rgba(127, 127, 127, 0.16)"),
            field: token("--dsw-specific-input-major", "Canvas"),
            border: token("--dsw-alias-border-l2", "rgba(127, 127, 127, 0.32)"),
            text: token("--dsw-alias-label-primary", "CanvasText"),
            textSecondary: token("--dsw-alias-label-secondary", "rgba(127, 127, 127, 0.95)"),
            track: token("--dsw-alias-interactive-bg-active", "rgba(127, 127, 127, 0.3)"),
            accent: token("--dsw-alias-state-business-primary", "#4176e6"),
            // State colours are tuned for fills and icons; as small text they
            // are too light on the light surface (warn ~2.6:1, success ~2.1:1).
            // Mixing 55% state colour with the theme's primary label keeps the
            // hue but lands above 4.5:1 on both themes (light #f5f6f7, dark
            // #353638); the mix direction follows the theme automatically.
            warnText: `color-mix(in srgb, ${token("--dsw-alias-state-warn-primary", "#f59e0b")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            dangerText: `color-mix(in srgb, ${token("--dsw-alias-state-error-primary", "#ec1313")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            successText: `color-mix(in srgb, ${token("--dsw-alias-state-success-primary", "#22c55e")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            onAccent: token("--dsw-alias-label-primary-foreground", "#fff"),
            shadow: token("--dsw-shadow-lv3", "0 0 1px rgba(0, 0, 0, 0.2), 0 12px 32px rgba(0, 0, 0, 0.12)")
        };
        const cardBase = {
            background: THEME.surface,
            color: THEME.text,
            border: `1px solid ${THEME.border}`,
            borderRadius: 14,
            boxShadow: THEME.shadow
        };

        const labelStyle = {
            fontSize: 12,
            color: THEME.textSecondary,
            marginBottom: 4
        };
        const inputStyle = {
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid " + THEME.border,
            background: THEME.field,
            color: THEME.text,
            fontSize: 13
        };
        const buttonStyle = {
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: token("--dsw-alias-button-primary-fill", "#4176e6"),
            color: THEME.onAccent,
            fontSize: 13,
            cursor: "pointer"
        };
        const ghostButtonStyle = {
            ...buttonStyle,
            background: "transparent",
            border: `1px solid ${THEME.border}`,
            color: THEME.text
        };

        // Right-aligned button above the composer card: it sends an ordinary
        // user message through the documented Session prompt API, exactly like
        // typing it and pressing Enter.
