/**
 * JSX type declarations for OpenTUI intrinsic elements.
 * Augments SolidJS's JSX namespace with terminal UI elements.
 */

import "solid-js";
import type { StyledText } from "@opentui/core";

type StyleProps = {
  width?: number | string;
  height?: number | string;
  flexGrow?: number;
  flexShrink?: number;
  flexDirection?: "row" | "column";
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  position?: "relative" | "absolute";
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  display?: "flex" | "none";
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch";
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around";
  overflow?: "visible" | "hidden";
  borderStyle?: "single" | "double" | "round" | "bold" | "none";
  borderColor?: string;
  gap?: number;
};

type CommonProps = StyleProps & {
  ref?: unknown;
  children?: unknown;
  backgroundColor?: string;
  bg?: string;
  fg?: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
};

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      box: CommonProps & {
        title?: string;
        titleAlignment?: "left" | "center" | "right";
        focusedBorderColor?: string;
        focusable?: boolean;
        focused?: boolean;
        border?: boolean;
      };
      text: CommonProps & {
        content?: StyledText | string;
        wrap?: "wrap" | "truncate" | "truncate-start" | "truncate-middle" | "truncate-end";
      };
      scrollbox: CommonProps & {
        scrollX?: boolean;
        scrollY?: boolean;
        stickyScroll?: boolean;
        stickyStart?: "bottom" | "top" | "left" | "right";
        focused?: boolean;
        viewportCulling?: boolean;
        scrollbarOptions?: {
          showArrows?: boolean;
          trackOptions?: { backgroundColor?: string };
        };
        verticalScrollbarOptions?: {
          showArrows?: boolean;
          trackOptions?: { backgroundColor?: string };
        };
        horizontalScrollbarOptions?: {
          showArrows?: boolean;
          trackOptions?: { backgroundColor?: string };
        };
      };
      framebuffer: CommonProps & {
        width: number;
        height: number;
      };
    }
  }
}
