// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import React from "react";

// The extension bundle is built by suite-base's webpack config, which supplies
// React as a global via ProvidePlugin. Babel's classic JSX runtime emits
// `React.createElement`, so tests need the same global to render JSX.
global.React = React;
