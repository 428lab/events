import { Box } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** イベント本文などを安全に Markdown 描画（生HTMLは無効＝XSS対策）。GFM対応。 */
export function Markdown({ children }: { children: string }) {
  return (
    <Box
      sx={{
        wordBreak: "break-word",
        "& > :first-of-type": { mt: 0 },
        "& > :last-child": { mb: 0 },
        "& p": { my: 1, lineHeight: 1.8 },
        "& h1": { fontSize: "1.5rem", mt: 2.5, mb: 1, fontWeight: 700 },
        "& h2": { fontSize: "1.25rem", mt: 2.5, mb: 1, fontWeight: 700 },
        "& h3": { fontSize: "1.1rem", mt: 2, mb: 1, fontWeight: 700 },
        "& ul, & ol": { pl: 3, my: 1 },
        "& li": { mb: 0.5 },
        "& code": {
          px: 0.6,
          py: 0.2,
          bgcolor: "action.hover",
          borderRadius: 0.5,
          fontFamily: "monospace",
          fontSize: "0.9em",
        },
        "& pre": {
          p: 1.5,
          my: 1.5,
          bgcolor: "action.hover",
          borderRadius: 1,
          overflowX: "auto",
        },
        "& pre code": { p: 0, bgcolor: "transparent" },
        "& blockquote": {
          borderLeft: "3px solid",
          borderColor: "divider",
          pl: 2,
          my: 1.5,
          color: "text.secondary",
        },
        "& img": { maxWidth: "100%", borderRadius: 1 },
        "& hr": {
          border: 0,
          borderTop: "1px solid",
          borderColor: "divider",
          my: 2,
        },
        "& table": { borderCollapse: "collapse", my: 1.5, width: "auto" },
        "& th, & td": {
          border: "1px solid",
          borderColor: "divider",
          px: 1,
          py: 0.5,
        },
        "& a": { color: "primary.main", textDecoration: "underline" },
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node: _node, ...props }) {
            return <a {...props} target="_blank" rel="noopener noreferrer" />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
