import logoMark from '../../../mobile/assets/images/avarpus-splash-mark.png';

export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <span
      aria-label="Avarpus"
      className={`${className} inline-block shrink-0 bg-[#006DA8] bg-gradient-to-br from-[#13B7F3] via-[#078BCB] to-[#005A91] [filter:drop-shadow(0_2px_3px_rgba(0,91,145,0.16))]`}
      role="img"
      style={{
        WebkitMaskImage: `url(${logoMark})`,
        WebkitMaskPosition: 'center',
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskSize: '108%',
        maskImage: `url(${logoMark})`,
        maskPosition: 'center',
        maskRepeat: 'no-repeat',
        maskSize: '108%',
      }}
    />
  );
}
