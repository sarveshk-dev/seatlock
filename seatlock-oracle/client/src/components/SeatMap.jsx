const AISLE_AFTER = 6;

const STATE_LABEL = {
  available: 'available',
  mine: 'selected by you',
  held: 'being reserved by someone else',
  booked: 'booked',
};

export default function SeatMap({ seats, onToggle, disabled }) {
  const rows = seats.reduce((acc, s) => {
    (acc[s.row] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="seatmap" role="group" aria-label="Seat map">
      <div className="screen" aria-hidden="true"><span>Screen</span></div>
      {Object.entries(rows).map(([row, list]) => (
        <div className="seat-row" key={row}>
          <span className="row-label" aria-hidden="true">{row}</span>
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`seat ${s.state}${s.number === AISLE_AFTER ? ' aisle' : ''}`}
              onClick={() => onToggle(s)}
              disabled={disabled || s.state === 'booked' || s.state === 'held'}
              aria-pressed={s.state === 'mine'}
              aria-label={`Row ${row}, seat ${s.number}, ${STATE_LABEL[s.state]}`}
              title={`${row}${s.number}`}
            >
              <span aria-hidden="true">{s.number}</span>
            </button>
          ))}
          <span className="row-label" aria-hidden="true">{row}</span>
        </div>
      ))}
      <ul className="legend">
        <li><i className="swatch available" />Available</li>
        <li><i className="swatch mine" />Yours</li>
        <li><i className="swatch held" />Reserved by someone</li>
        <li><i className="swatch booked" />Booked</li>
      </ul>
    </div>
  );
}
