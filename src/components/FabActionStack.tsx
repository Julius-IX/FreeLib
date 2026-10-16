import { useEffect, useState, type ReactNode } from 'react';
import Fab from '@mui/material/Fab';
import Zoom from '@mui/material/Zoom';
import Box from '@mui/material/Box';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { useModalMounted } from '@/modal/modalMounted';

export interface FabAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export default function FabActionStack({ actions }: { actions: FabAction[] }) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const modalMounted = useModalMounted();

  useEffect(() => {
    if (held && modalMounted) setHeld(false);
  }, [held, modalMounted]);

  const scrimOn = open || (held && !modalMounted);

  return (
    <>
      <Box
        onClick={() => setOpen(false)}
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          backgroundColor: scrimOn ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
          transition: held ? 'none' : 'background-color 200ms',
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      <Zoom in={!open}>
        <Fab
          color="primary"
          aria-label="Open actions"
          onClick={() => setOpen(true)}
          sx={{ position: 'absolute', right: 16, bottom: 16, zIndex: 2 }}
        >
          <MenuBookIcon />
        </Fab>
      </Zoom>

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
                setHeld(true);
                setOpen(false);
                a.onClick();
                setTimeout(() => setHeld(false), 400);
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
