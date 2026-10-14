import Fab from '@mui/material/Fab';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import AddIcon from '@mui/icons-material/Add';
import type { ReactNode } from 'react';

interface FloatingActionButtonProps {
  onClick: () => void;
  label?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export default function FloatingActionButton({
  onClick,
  label = '',
  icon = <AddIcon />,
  disabled = false,
}: FloatingActionButtonProps) {
  const hasLabel = label.length > 0;

  return (
    <Tooltip title={label} placement="left">
      <span>
        <Fab
          color="primary"
          aria-label={label || 'action'}
          variant={hasLabel ? 'extended' : 'circular'}
          onClick={onClick}
          disabled={disabled}
          sx={{
            position: 'absolute',
            right: { xs: 16, md: 32 },
            bottom: { xs: 'calc(16px + env(safe-area-inset-bottom))', md: 32 },
          }}
        >
          <Box
            component="span"
            sx={{ display: 'flex', mr: hasLabel ? { xs: 0, md: 1 } : 0 }}
          >
            {icon}
          </Box>
          {hasLabel && (
            <Box component="span" sx={{ display: { xs: 'none', md: 'inline' } }}>
              {label}
            </Box>
          )}
        </Fab>
      </span>
    </Tooltip>
  );
}
