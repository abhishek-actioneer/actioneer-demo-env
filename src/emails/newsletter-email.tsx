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
  Link,
  Hr,
  Preview,
} from "@react-email/components";
import type { MarketingEmailProps } from "./marketing-email";

/**
 * NewsletterEmail — long-form, multi-section. Header, intro, body, optional features
 * as article previews, footer with social. Uses MarketingEmailProps so the editor
 * can pass the same derived spec to any template.
 */
export function NewsletterEmail(props: MarketingEmailProps) {
  const theme = {
    bg: "#fafaf7",
    surface: "#ffffff",
    text: "#1a1a1a",
    muted: "#6b7280",
    accent: "#dc2626",
    ...(props.theme ?? {}),
  };
  const brandName = props.brandName ?? "Sentinel Weekly";
  const preheader = props.preheader ?? props.hero.subhead ?? props.hero.headline;

  return (
    <Html>
      <Head>
        <Font
          fontFamily="Charter"
          fallbackFontFamily="Georgia"
          webFont={{
            url: "https://fonts.gstatic.com/s/notoseriff/v15/ga6yaxFv5qtxs0nC8O2-bVnhKaHpMRG6lA.woff2",
            format: "woff2",
          }}
          fontWeight={400}
          fontStyle="normal"
        />
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
            maxWidth: "640px",
            margin: "0 auto",
            padding: "20px 0",
            boxSizing: "border-box",
          }}
        >
          {/* MASTHEAD */}
          <Section style={{ padding: "0 32px 24px", borderBottom: `2px solid ${theme.text}` }}>
            <Text
              style={{
                color: theme.text,
                fontFamily: "'Charter', Georgia, serif",
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                margin: "16px 0 4px",
              }}
            >
              {brandName}
            </Text>
            <Text
              style={{
                color: theme.muted,
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                margin: "0 0 12px",
              }}
            >
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </Text>
          </Section>

          {/* LEAD */}
          <Section style={{ padding: "32px 32px 0", backgroundColor: theme.surface }}>
            <Heading
              as="h1"
              style={{
                color: theme.text,
                fontFamily: "'Charter', Georgia, serif",
                fontSize: 36,
                lineHeight: "1.15",
                letterSpacing: "-0.02em",
                margin: "0 0 12px",
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
                  lineHeight: "1.55",
                  margin: "0 0 24px",
                }}
              >
                {props.hero.subhead}
              </Text>
            )}
          </Section>

          {/* BODY */}
          {props.bodyHtml && (
            <Section style={{ padding: "16px 32px 24px", backgroundColor: theme.surface }}>
              <div
                style={{
                  color: theme.text,
                  fontFamily: "'Charter', Georgia, serif",
                  fontSize: 17,
                  lineHeight: "1.7",
                }}
                dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
              />
            </Section>
          )}

          {/* ARTICLES (uses features array) */}
          {props.features && props.features.length > 0 && (
            <Section style={{ padding: "8px 32px 32px", backgroundColor: theme.surface }}>
              <Hr style={{ borderColor: "#e5e5e5", margin: "0 0 24px" }} />
              <Heading
                as="h2"
                style={{
                  color: theme.text,
                  fontFamily: "'Inter', Helvetica, sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  margin: "0 0 16px",
                }}
              >
                Also this week
              </Heading>
              {props.features.map((f, i) => (
                <Row key={i} style={{ marginBottom: 16 }}>
                  <Column>
                    <Text
                      style={{
                        color: theme.text,
                        fontFamily: "'Charter', Georgia, serif",
                        fontSize: 18,
                        fontWeight: 700,
                        margin: "0 0 4px",
                        lineHeight: "1.3",
                      }}
                    >
                      {f.title}
                    </Text>
                    <Text
                      style={{
                        color: theme.muted,
                        fontFamily: "'Inter', Helvetica, sans-serif",
                        fontSize: 14,
                        lineHeight: "1.55",
                        margin: 0,
                      }}
                    >
                      {f.body}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
          )}

          {/* FOOTER */}
          <Section style={{ padding: "32px", textAlign: "center" }}>
            {props.footer?.logoUrl && (
              <Img
                src={props.footer.logoUrl}
                alt={brandName}
                width={120}
                height={32}
                style={{ margin: "0 auto 16px" }}
              />
            )}
            <Text
              style={{
                color: theme.muted,
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 13,
                lineHeight: "1.55",
                margin: "0 0 12px",
              }}
            >
              {props.footer?.address ?? `Sent by ${brandName}. You're receiving this because you subscribed.`}
            </Text>
            <Text
              style={{
                fontFamily: "'Inter', Helvetica, sans-serif",
                fontSize: 13,
                margin: 0,
              }}
            >
              <Link
                href={props.footer?.unsubscribeHref ?? "#"}
                style={{ color: theme.muted, textDecoration: "underline", fontWeight: 600 }}
              >
                Unsubscribe
              </Link>
              {" · "}
              <Link
                href={props.footer?.privacyHref ?? "#"}
                style={{ color: theme.muted, textDecoration: "underline", fontWeight: 600 }}
              >
                Privacy
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
