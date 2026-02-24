// SPDX-FileCopyrightText: Copyright (C) 2023-2025 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { SvgIcon, SvgIconProps } from "@mui/material";

export default function BringupLogoText(props: SvgIconProps): React.JSX.Element {
  return (
    <SvgIcon viewBox="0 0 600 224" {...props}>
      <title>Visualizer</title>
      <g transform="translate(-66.047,-40.427)">
        <path
          d="m 148.16667,121.70833 v 23.8125 c 0,2.59287 2.08581,5.0185 4.57233,5.74818 16.68031,4.89491 28.44199,20.26746 28.44219,38.01918 2e-5,17.82771 -11.86235,33.25595 -28.6561,38.08181 -2.37254,0.68177 -4.35842,2.99346 -4.35842,5.46332 l 0,23.8125 c 0,4.22309 3.42407,7.3854 7.57053,6.59401 35.104,-6.69993 61.11021,-37.50562 61.11003,-73.95164 -7e-5,-36.52152 -26.11437,-67.37918 -61.32889,-73.99256 -4.02802,-0.75647 -7.35167,2.31263 -7.35167,6.4127 z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="m 141.55208,162.82985 a 26.45833,26.458332 0 0 0 -6.61458,0.84026 26.45833,26.458332 0 0 0 -19.84375,25.61808 26.45833,26.458332 0 0 0 19.84375,25.61859 26.45833,26.458332 0 0 0 6.61458,0.83974 26.45833,26.458332 0 0 0 6.61459,-0.83974 26.45833,26.458332 0 0 0 19.84375,-25.61859 26.45833,26.458332 0 0 0 -19.84375,-25.61808 26.45833,26.458332 0 0 0 -6.61459,-0.84026 z"
          fill="currentColor"
          stroke="none"
        />
        <path
          d="m 77.540599,41.0247 c 10.849577,3.739207 20.545139,11.031257 29.182461,18.353767 16.45612,14.614554 29.4661,35.497315 28.21443,58.213263 v 27.9291 c 0,2.59287 -2.09563,4.96679 -4.58734,5.67693 -18.15381,5.17389 -31.147747,24.52573 -28.0666,43.4451 1.84961,15.28617 13.57734,28.59265 28.28724,32.76677 2.37452,0.6738 4.3667,2.95383 4.3667,5.42369 v 23.8125 c 0,4.22309 -3.4305,7.44425 -7.58022,6.67261 C 97.886705,257.83841 72.876103,233.28889 67.613714,203.5737 65.280094,189.14047 66.582535,174.45608 66.227417,159.88447 66.202837,123.34659 66.178273,86.8087 66.15369,50.270825 66.149348,43.818197 71.456282,38.927797 77.540599,41.0247 Z"
          fill="currentColor"
          stroke="none"
        />
      </g>
      <text
        x="185"
        y="155"
        fill="currentColor"
        fontFamily="Inter, Roboto, Arial, sans-serif"
        fontWeight="700"
        fontSize="72"
        letterSpacing="6"
      >
        VISUALIZER
      </text>
    </SvgIcon>
  );
}
