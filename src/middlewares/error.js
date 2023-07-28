export default function(err, req, res) {
	res.status(500).json({
		message: err
	})
}
