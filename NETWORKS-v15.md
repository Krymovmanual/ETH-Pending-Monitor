# Paseqa Treasury v15

## Gas intelligence

- Standard gas distribution by weekday using up to 180 days of stored samples.
- Standard gas distribution by hour using the latest 30 days.
- Actual hourly gas trend with a clearly labelled six-hour statistical projection.
- Native SVG charts with no third-party chart runtime or data sharing.
- Gas sample retention increased from 30 to 180 days; existing data remains compatible.

## Interface

- Authenticated pages enter the new application shell before session loading, removing the old-design flash between sections.
- A lightweight loading state is shown while the encrypted session is restored.
- Product identity is now `Paseqa` with `Treasury` as the product descriptor and a subtle honeycomb-shaped mark.
- Health endpoint reports the actual package version for deployment verification.
