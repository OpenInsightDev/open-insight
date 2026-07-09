// Copyright (c) Meta Platforms, Inc. and affiliates.

"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";

const materialStats = [
  ["Opacity", "72%"],
  ["Blur", "20px"],
  ["Saturation", "1.10x"],
  ["Edge", "1px"],
];

const materialRows = [
  ["Mica base", "8px", "High"],
  ["Focused glass", "20px", "High"],
  ["Transient frost", "32px", "Low"],
];

const notes = [
  "Floating hierarchy is reserved for the focused working layer.",
  "The interface stays neutral; blue appears only as meaningful state.",
  "Small radii, visible edges, and restrained elevation carry the material tone.",
];

export default function MaterialHome() {
  return (
    <AppShell variant="elevated" contentPadding={0} height="auto">
      <Layout
        height="auto"
        contentWidth={1120}
        content={
          <LayoutContent padding={6}>
            <VStack gap={5}>
              <HStack hAlign="between" vAlign="end" gap={5}>
                <VStack gap={1.5}>
                  <Text type="supporting">Dashboard material system</Text>
                  <Heading level={1} type="display-3" textWrap="balance">
                    Quiet gray glass for focused work
                  </Heading>
                  <Text type="large" as="p" color="secondary" textWrap="pretty">
                    A restrained dashboard surface built from Astryx primitives: neutral layers,
                    precise borders, readable density, and a single blue state color.
                  </Text>
                </VStack>
                <Card variant="blue" padding={2}>
                  <Text type="label" color="primary">
                    #0077CC focus
                  </Text>
                </Card>
              </HStack>

              <Grid columns={{ minWidth: 320, max: 2, repeat: "fit" }} gap={3} width="100%">
                <Card variant="default" padding={5} minHeight={420}>
                  <VStack gap={4}>
                    <VStack gap={1}>
                      <Text type="supporting">Base layer</Text>
                      <Heading level={2} textWrap="balance">
                        Material visibility over dense content
                      </Heading>
                    </VStack>
                    <Text type="body" as="p" color="secondary" textWrap="pretty">
                      The background remains calm and legible. It provides enough document texture
                      to judge a floating layer without becoming a decorative scene.
                    </Text>
                    <Section variant="muted" padding={3} dividers={["top", "bottom"]}>
                      <Grid columns={3} gap={2} width="100%">
                        <Text type="label">Surface</Text>
                        <Text type="label">Blur</Text>
                        <Text type="label">Read</Text>
                        {materialRows.flatMap((row) =>
                          row.map((cell) => (
                            <Text key={`${row[0]}-${cell}`} type="supporting">
                              {cell}
                            </Text>
                          )),
                        )}
                      </Grid>
                    </Section>
                  </VStack>
                </Card>

                <Card variant="muted" padding={5} minHeight={420}>
                  <VStack gap={4}>
                    <HStack hAlign="between" vAlign="start" gap={4}>
                      <VStack gap={1}>
                        <Text type="supporting">Focused layer</Text>
                        <Heading level={2}>Measured glass</Heading>
                      </VStack>
                      <Card variant="blue" padding={1.5}>
                        <Text type="label">focused</Text>
                      </Card>
                    </HStack>
                    <Text type="body" as="p" color="secondary" textWrap="pretty">
                      The active surface becomes the clearest object in the workspace through
                      hierarchy, spacing, and system elevation rather than custom decoration.
                    </Text>
                    <Grid columns={{ minWidth: 120, max: 4, repeat: "fit" }} gap={2} width="100%">
                      {materialStats.map(([label, value]) => (
                        <Card key={label} variant="default" padding={3}>
                          <VStack gap={1}>
                            <Text type="supporting">{label}</Text>
                            <Text type="label" hasTabularNumbers>
                              {value}
                            </Text>
                          </VStack>
                        </Card>
                      ))}
                    </Grid>
                    <Section variant="section" padding={3} dividers={["top"]}>
                      <VStack gap={1.5}>
                        <Text type="label">Secondary layer sample</Text>
                        <Text type="supporting" as="p" textWrap="pretty">
                          Non-focused content remains present but quieter, while the focused region
                          earns stronger contrast and a more explicit boundary.
                        </Text>
                      </VStack>
                    </Section>
                  </VStack>
                </Card>
              </Grid>

              <Grid columns={{ minWidth: 240, max: 3, repeat: "fit" }} gap={3} width="100%">
                {notes.map((note) => (
                  <Section key={note} variant="section" padding={3} dividers={["top"]}>
                    <Text type="body" color="secondary" as="p" textWrap="pretty">
                      {note}
                    </Text>
                  </Section>
                ))}
              </Grid>
            </VStack>
          </LayoutContent>
        }
      />
    </AppShell>
  );
}
