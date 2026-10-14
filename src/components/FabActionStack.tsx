import { useState, type ReactNode } from 'react';
import Fab from '@mui/material/Fab';
import Zoom from '@mui/material/Zoom';
import Box from '@mui/material/Box';
import AddIcon from '@mui/icons-material/Add';

export interface FabAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export default function FabActionStack({ actions }: { actions: FabAction[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* click-away layer, scoped to the parent container */}
      <Box
        onClick={() => setOpen(false)}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          backgroundColor: open ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
          transition: 'background-color 200ms',
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* the + button, hidden while the stack is open */}
      <Zoom in={!open}>
        <Fab
          color="primary"
          aria-label="Open actions"
          onClick={() => setOpen(true)}
          sx={{ position: 'absolute', right: 16, bottom: 16, zIndex: 2 }}
        >
          <AddIcon />
        </Fab>
      </Zoom>

      {/* the stack of buttons */}
      <Box
        sx={{
          position: 'absolute',
          right: 16,
          bottom: 16,
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 1.5,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {actions.map((a, i) => (
          <Zoom
            key={a.label}
            in={open}
            unmountOnExit
            style={{ transitionDelay: open ? `${i * 40}ms` : '0ms' }}
          >
            <Fab
              variant="extended"
              color="primary"
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              {a.icon && <Box sx={{ display: 'flex', mr: 1 }}>{a.icon}</Box>}
              {a.label}
            </Fab>
          </Zoom>
        ))}
      </Box>
    </>
  );
}
