import * as React from "react";
import {
  Html,
  Head,
  Font,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Hr,
  Link,
  Preview,
} from "@react-email/components";
import type { MarketingEmailProps } from "./marketing-email";

/**
 * AnnouncementEmail — minimal, single-column. Big headline, body, one CTA, footer.
 * Uses a stripped subset of MarketingEmailProps so all templates share one spec shape.
 */
export function AnnouncementEmail(props: MarketingEmailProps) {
  const theme = {
    bg: "#f4f4f4",
    surface: "#ffffff",
    text: "#0a0a0a",
    muted: "#6b7280",
    accent: "#0a0a0a",
    ...(props.theme ?? {}),
  };
  const brandName = props.brandName ?? "Sentinel";
  const preheader = props.preheader ?? props.hero.subhead ?? props.hero.headline;
  const cta = props.hero.cta ?? props.closing?.cta;

  return (
    <Html>
      <Head>
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Helvetica"
          webFont={{
            url: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff2",
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
            maxWidth: "560px",
            margin: "0 auto",
            padding: "32px 0",
            boxSizing: "border-box",
          }}
        >
          <Section
            style={{
              backgroundColor: theme.surface,
              padding: "48px 40px",
              borderRadius: 12,
            }}
          >
            <Text
              style={{
                color: theme.muted,
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                margin: "0 0 24px",
              }}
            >
              {brandName}
            </Text>
            <Heading
              as="h1"
              style={{
                color: theme.text,
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 32,
                lineHeight: "1.2",
                letterSpacing: "-0.02em",
                margin: "0 0 16px",
                fontWeight: 700,
              }}
            >
              {props.hero.headline}
            </Heading>
            {props.hero.subhead && (
              <Text
                style={{
                  color: theme.muted,
                  fontFamily: "'Inter', Helvetica, sans-serif",
                  fontSize: 16,
                  lineHeight: "1.6",
                  margin: "0 0 24px",
                }}
              >
                {props.hero.subhead}
              </Text>
            )}
            {props.bodyHtml && (
              <div
                style={{
                  color: theme.text,
                  fontFamily: "'Inter', Helvetica, sans-serif",
                  fontSize: 15,
                  lineHeight: "1.65",
                  margin: "0 0 32px",
                }}
                dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
              />
            )}
            {cta && (
              <Section style={{ textAlign: "left", margin: "0 0 8px" }}>
                <Button
                  href={cta.href}
                  style={{
                    backgroundColor: theme.accent,
                    color: "#ffffff",
                    fontFamily: "'Inter', Helvetica, sans-serif",
                    fontWeight: 600,
                    fontSize: 15,
                    padding: "12px 22px",
                    borderRadius: 8,
                    textDecoration: "none",
                  }}
                >
                  {cta.label}
                </Button>
              </Section>
            )}
            <Hr style={{ borderColor: "#e5e5e5", margin: "32px 0 20px" }} />
            <Text
              style={{
                color: theme.muted,
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 12,
                lineHeight: "1.5",
                margin: 0,
              }}
            >
              {props.footer?.address ?? `Sent by ${brandName}.`} ·{" "}
              <Link href={props.footer?.unsubscribeHref ?? "#"} style={{ color: theme.muted, textDecoration: "underline" }}>
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
