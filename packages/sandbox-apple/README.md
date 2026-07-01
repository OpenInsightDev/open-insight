# OpenInsight Sandbox Provider - Apple Container

Sandbox provider for [Apple Container](https://github.com/apple/container).

This provider wraps the `container` CLI (Apple's container runtime on macOS) to
manage OCI containers as sandbox environments for the Open Insight agent framework.

## Features

- Build container images from Open Insight snapshot definitions
- Run sandbox containers with automatic cleanup
- File read/write via `container exec`
- File transfer via `container cp`
- Port mapping configuration
