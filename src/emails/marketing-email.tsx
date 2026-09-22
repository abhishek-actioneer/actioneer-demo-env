import * as React from "react";
import {
  Html,
  Head,
  Font,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Img,
  Button,
  Hr,
  Link,
  Preview,
} from "@react-email/components";

export interface MarketingEmailProps {
  brandName?: string;
  preheader?: string;
  hero: {
    eyebrow?: string;
    headline: string;
    subhead?: string;
    bgImage?: string;
    cta?: { label: string; href: string };
  };
  features?: Array<{ title: string; body: string; icon?: string }>;
  imageSection?: {
    image: string;
    heading: string;
    body: string;
    cta?: { label: string; href: string };
  };
  /** Raw HTML body inserted between the hero and the closing block.
   *  This is how draft content from the editor gets rendered inside the marketing shell. */
  bodyHtml?: string;
  closing?: {
    heading: string;
    body: string;
    cta: { label: string; href: string };
  };
  footer?: {
    logoUrl?: string;
    address?: string;
    unsubscribeHref?: string;
    privacyHref?: string;
    socials?: Array<{ label: string; href: string; iconUrl: string }>;
  };
  theme?: {
    bg?: string;
    surface?: string;
    accent?: string;
    text?: string;
    muted?: string;
  };
}

const DEFAULT_THEME = {
  bg: "#c8d6c0",
  surface: "#ffffff",
  accent: "#8e9b53",
  text: "#3c4804",
  muted: "#6e6e6e",
};

export function MarketingEmail(props: MarketingEmailProps) {
  const theme = { ...DEFAULT_THEME, ...(props.theme ?? {}) };
  const brandName = props.brandName ?? "Actioneer";
  const preheader = props.preheader ?? props.hero.subhead ?? props.hero.headline;

  return (
    <Html>
      <Head>
        <Font
          fontFamily="Lato"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://fonts.gstatic.com/s/lato/v25/S6uyw4BMUTPHjxAwXg.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
        <Font
          fontFamily="Lato"
          fallbackFontFamily="Arial"
          webFont={{
            url: "https://fonts.gstatic.com/s/lato/v25/S6u9w4BMUTPHh6UVSwaPGQ.woff2",
            format: "woff2",
          }}
          fontWeight={700}
          fontStyle="normal"
        />
        <Font
          fontFamily="DM Serif Text"
          fallbackFontFamily="Georgia"
          webFont={{
            url: "https://fonts.gstatic.com/s/dmseriftext/v13/rnCu-xZa_krGokauCeNq1wWyWfqFXQ.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Preview>{preheader}</Preview>
      <Body style={{ backgroundColor: theme.bg, margin: 0, padding: 0 }}>
        <Container
          style={{
            width: "100%",
            maxWidth: "600px",
            margin: "0 auto",
            padding: "20px 0",
            boxSizing: "border-box",
          }}
        >
          {/* HERO */}
          <Section
            style={{
              backgroundColor: theme.text,
              backgroundImage:
                props.hero.bgImage && props.hero.bgImage.trim()
                  ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.45)), url(${props.hero.bgImage})`
                  : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              padding: "44px 32px 56px",
              textAlign: "center",
            }}
          >
            <Row>
              <Column align="left">
                <Text
                  style={{
                    color: "#ffffff",
                    fontFamily: "'Lato', Arial, sans-serif",
                    fontSize: 16,
                    fontWeight: 700,
                    margin: 0,
                  }}
                >
                  {brandName}
                </Text>
              </Column>
            </Row>
            <Section style={{ paddingTop: 80, paddingBottom: 24 }}>
              {props.hero.eyebrow && (
                <Text
                  style={{
                    color: "#ffffffcc",
                    fontFamily: "'Lato', Arial, sans-serif",
                    fontSize: 14,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    margin: "0 0 12px",
                    textAlign: "center",
                  }}
                >
                  {props.hero.eyebrow}
                </Text>
              )}
              <Heading
                as="h1"
                style={{
                  color: "#ffffff",
                  fontFamily: "'DM Serif Text', Georgia, serif",
                  fontSize: 40,
                  lineHeight: "1.1",
                  letterSpacing: "-0.02em",
                  margin: "0 0 16px",
                  textAlign: "center",
                  fontWeight: 400,
                  wordBreak: "break-word",
                }}
              >
                {props.hero.headline}
              </Heading>
              {props.hero.subhead && (
                <Text
                  style={{
                    color: "#ffffffcc",
                    fontFamily: "'Lato', Arial, sans-serif",
                    fontSize: 16,
                    lineHeight: "1.5",
                    margin: "0 auto",
                    maxWidth: 460,
                    textAlign: "center",
                  }}
                >
                  {props.hero.subhead}
                </Text>
              )}
            </Section>
            {props.hero.cta && (
              <Section style={{ paddingTop: 24, textAlign: "center" }}>
                <Button
                  href={props.hero.cta.href}
                  style={{
                    backgroundColor: theme.accent,
                    color: "#ffffff",
                    fontFamily: "'Lato', Arial, sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    padding: "16px 36px",
                    borderRadius: 40,
                    textDecoration: "none",
                  }}
                >
                  {props.hero.cta.label}
                </Button>
              </Section>
            )}
          </Section>

          {/* FEATURES */}
          {props.features && props.features.length > 0 && (
            <Section
              style={{
                backgroundColor: theme.surface,
                padding: "32px 24px 16px",
              }}
            >
              <Section
                style={{
                  backgroundColor: "#f0f4ef",
                  borderRadius: 16,
                  padding: "32px 30px",
                }}
              >
                <Heading
                  as="h2"
                  style={{
                    color: theme.text,
                    fontFamily: "'DM Serif Text', Georgia, serif",
                    fontSize: 36,
                    lineHeight: "1.1",
                    letterSpacing: "-0.02em",
                    textAlign: "center",
                    margin: "0 0 12px",
                    fontWeight: 400,
                  }}
                >
                  What&apos;s included
                </Heading>
                <Text
                  style={{
                    color: theme.muted,
                    fontFamily: "'Lato', Arial, sans-serif",
                    fontSize: 15,
                    lineHeight: "1.5",
                    textAlign: "center",
                    margin: "0 0 28px",
                  }}
                >
                  Designed to make your next step easier.
                </Text>
                {props.features.map((f, i) => (
                  <Row key={i} style={{ marginBottom: 12 }}>
                    <Column style={{ width: 32, verticalAlign: "top" }}>
                      {f.icon && (
                        <Img
                          src={f.icon}
                          alt=""
                          width={26}
                          height={26}
                          style={{ display: "block" }}
                        />
                      )}
                    </Column>
                    <Column>
                      <Text
                        style={{
                          color: theme.text,
                          fontFamily: "'Lato', Arial, sans-serif",
                          fontSize: 15,
                          fontWeight: 700,
                          margin: "0 0 2px",
                        }}
                      >
                        {f.title}
                      </Text>
                      <Text
                        style={{
                          color: theme.muted,
                          fontFamily: "'Lato', Arial, sans-serif",
                          fontSize: 14,
                          lineHeight: "1.5",
                          margin: 0,
                        }}
                      >
                        {f.body}
                      </Text>
                    </Column>
                  </Row>
                ))}
              </Section>
            </Section>
          )}

          {/* BODY (from editor) */}
          {props.bodyHtml && (
            <Section
              style={{
                backgroundColor: theme.surface,
                padding: "32px 32px 16px",
              }}
            >
              <div
                style={{
                  color: theme.text,
                  fontFamily: "'Lato', Arial, sans-serif",
                  fontSize: 16,
                  lineHeight: "1.6",
                }}
                dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
              />
            </Section>
          )}

          {/* IMAGE SECTION */}
          {props.imageSection && (
            <Section
              style={{
                backgroundColor: theme.surface,
                padding: "0 24px 24px",
              }}
            >
              <Section
                style={{
                  backgroundImage: `url(${props.imageSection.image})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  borderRadius: 16,
                  padding: "320px 24px 24px",
                }}
              >
                <Section
                  style={{
                    backgroundColor: "#ffffff",
                    borderRadius: 14,
                    padding: "20px 24px",
                    width: "82%",
                    margin: "0 auto",
                  }}
                >
                  <Heading
                    as="h3"
                    style={{
                      color: theme.text,
                      fontFamily: "'DM Serif Text', Georgia, serif",
                      fontSize: 22,
                      margin: "0 0 8px",
                      fontWeight: 400,
                      textAlign: "center",
                    }}
                  >
                    {props.imageSection.heading}
                  </Heading>
                  <Text
                    style={{
                      color: theme.muted,
                      fontFamily: "'Lato', Arial, sans-serif",
                      fontSize: 14,
                      lineHeight: "1.5",
                      textAlign: "center",
                      margin: 0,
                    }}
                  >
                    {props.imageSection.body}
                  </Text>
                </Section>
              </Section>
            </Section>
          )}

          {/* CLOSING */}
          {props.closing && (
            <Section
              style={{
                backgroundColor: "#f0f4ef",
                padding: "52px 24px",
                textAlign: "center",
              }}
            >
              <Heading
                as="h2"
                style={{
                  color: theme.text,
                  fontFamily: "'DM Serif Text', Georgia, serif",
                  fontSize: 36,
                  lineHeight: "1.1",
                  letterSpacing: "-0.02em",
                  margin: "0 0 16px",
                  fontWeight: 400,
                }}
              >
                {props.closing.heading}
              </Heading>
              <Text
                style={{
                  color: theme.muted,
                  fontFamily: "'Lato', Arial, sans-serif",
                  fontSize: 16,
                  lineHeight: "1.5",
                  margin: "0 auto 32px",
                  maxWidth: 460,
                }}
              >
                {props.closing.body}
              </Text>
              <Button
                href={props.closing.cta.href}
                style={{
                  backgroundColor: theme.accent,
                  color: "#ffffff",
                  fontFamily: "'Lato', Arial, sans-serif",
                  fontWeight: 700,
                  fontSize: 16,
                  padding: "16px 36px",
                  borderRadius: 40,
                  textDecoration: "none",
                }}
              >
                {props.closing.cta.label}
              </Button>
            </Section>
          )}

          {/* FOOTER */}
          <Section
            style={{
              backgroundColor: "#1f1f1f",
              padding: "32px 24px",
              borderRadius: "0 0 16px 16px",
            }}
          >
            {props.footer?.logoUrl && (
              <Section style={{ textAlign: "center", paddingBottom: 24 }}>
                <Img
                  src={props.footer.logoUrl}
                  alt={brandName}
                  width={120}
                  height={40}
                  style={{ margin: "0 auto" }}
                />
              </Section>
            )}
            {props.footer?.socials && props.footer.socials.length > 0 && (
              <Section style={{ textAlign: "center", paddingBottom: 24 }}>
                {props.footer.socials.map((s, i) => (
                  <Link
                    key={i}
                    href={s.href}
                    style={{
                      display: "inline-block",
                      margin: "0 6px",
                      padding: 10,
                      borderRadius: 999,
                      border: "1px solid #ffffff80",
                      backgroundColor: "#ffffff14",
                    }}
                  >
                    <Img src={s.iconUrl} alt={s.label} width={20} height={20} />
                  </Link>
                ))}
              </Section>
            )}
            <Hr style={{ borderColor: "#ffffff33", margin: "0 0 20px" }} />
            <Text
              style={{
                color: "#ffffffcc",
                fontFamily: "'Lato', Arial, sans-serif",
                fontSize: 13,
                lineHeight: "1.5",
                textAlign: "center",
                margin: "0 0 12px",
              }}
            >
              {props.footer?.address ??
                `Sent by ${brandName}. You're receiving this because you opted in.`}
            </Text>
            <Text
              style={{
                fontFamily: "'Lato', Arial, sans-serif",
                fontSize: 13,
                textAlign: "center",
                margin: 0,
              }}
            >
              <Link
                href={props.footer?.unsubscribeHref ?? "#"}
                style={{ color: "#ffffff", textDecoration: "underline", fontWeight: 700 }}
              >
                Unsubscribe
              </Link>{" "}
              <span style={{ color: "#ffffff66" }}>|</span>{" "}
              <Link
                href={props.footer?.privacyHref ?? "#"}
                style={{ color: "#ffffff", textDecoration: "underline", fontWeight: 700 }}
              >
                Privacy Policy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Hardcoded demo data so the v0 render endpoint can produce a realistic email
 *  without any spec wiring. Replace with the real spec once /api/email/render
 *  accepts a body. */
export const DEMO_PROPS: MarketingEmailProps = {
  brandName: "Sentinel",
  preheader: "Your perfect payment history just unlocked something better",
  hero: {
    eyebrow: "For our top-tier members",
    headline: "Recognition for your perfect payment history",
    subhead:
      "You've been part of our most valued group of borrowers. Here's what's now available to you.",
    cta: { label: "View your benefits", href: "https://example.com/benefits" },
    bgImage: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200",
  },
  features: [
    {
      title: "Preferential rates on top-ups",
      body: "Up to 50 bps off our published rate when you draw against your existing loan.",
    },
    {
      title: "Priority underwriting",
      body: "Your file moves to the top of the queue. Same-week decisions on standard limits.",
    },
    {
      title: "Dedicated relationship line",
      body: "Direct number to a senior officer for any account or product question.",
    },
  ],
  imageSection: {
    image: "https://images.unsplash.com/photo-1600585154526-990dced4db0d?w=1200",
    heading: "Your trust, recognized",
    body: "We notice the consistency. We notice the discipline. This is our way of saying it back.",
  },
  closing: {
    heading: "Ready to use what you've earned?",
    body: "Open the dashboard to see your offers, or reply to this email and a senior officer will reach out within one business day.",
    cta: { label: "Open dashboard", href: "https://example.com/dashboard" },
  },
  footer: {
    address: "Sentinel Financial · 12 MG Road · Bengaluru 560001",
    unsubscribeHref: "https://example.com/unsubscribe",
    privacyHref: "https://example.com/privacy",
  },
};
